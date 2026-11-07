"""SceneSpindle cinematic stage for Blender (trusted scene builder).

Run headless only:
  blender -b --factory-startup --disable-autoexec -noaudio -P scripts/blender/stage.py -- stage.json frames_dir

stage.json holds validated enums, numbers and #rrggbb colours (see src/pipeline/cinematic.ts).
The scene mirrors the real-time Three.js stage: the same sets, performers, actions, shots and
mouth timing, rendered with EEVEE soft shadows. No text from the plan reaches this script.
"""
import json
import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
DATA = json.load(open(argv[0]))
OUT = argv[1]
FPS = int(DATA.get("fps", 30))
W, H = int(DATA["w"]), int(DATA["h"])
FRAMES = max(1, int(round(float(DATA["duration"]) * FPS)))
PORTRAIT = H > W

ACTIONS = {"talk", "walk", "turn", "wave", "hold", "point", "sit", "jump"}
SETS = {"home", "bank", "lane", "room", "street", "park", "school", "office", "night", "market"}

# ---------- scene setup ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
try:
    scene.eevee.taa_render_samples = 16
except AttributeError:
    pass
# PNG frames work in every Blender version (5.x moved video output); FFmpeg encodes them after.
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.filepath = OUT.rstrip("/") + "/"
scene.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]


def hex_rgb(value):
    value = value.lstrip("#")
    srgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4) for c in srgb)


def int_rgb(n):
    return hex_rgb("#%06x" % n)


_mats = {}


def mat(color, rough=0.6):
    key = (color, rough)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new("m%d" % len(_mats))
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    rgb = hex_rgb(color) if isinstance(color, str) else int_rgb(color)
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    _mats[key] = m
    return m


def add(obj, material, parent=None):
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    return obj


def box(w, h, d, color, x, y, z, rough=0.6, parent=None):
    # Three.js is y-up; Blender is z-up. Map (x, y, z) -> (x, -z, y).
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    o = bpy.context.active_object
    o.scale = (w, d, h)
    return add(o, mat(color, rough), parent)


def sphere(r, color, x, y, z, rough=0.5, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, -z, y), segments=24, ring_count=16)
    o = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return add(o, mat(color, rough), parent)


def cylinder(r1, r2, h, color, x, y, z, parent=None):
    bpy.ops.mesh.primitive_cone_add(radius1=r2, radius2=r1, depth=h, location=(x, -z, y), vertices=24)
    o = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return add(o, mat(color, 0.5), parent)


def empty(name, x=0, y=0, z=0, parent=None):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.location = (x, -z, y)
    if parent is not None:
        o.parent = parent
    return o


# ---------- ground, lights ----------
bpy.ops.mesh.primitive_circle_add(radius=12, fill_type="NGON", location=(0, 0, 0))
ground = bpy.context.active_object
ground_mat = bpy.data.materials.new("ground")
ground_mat.use_nodes = True
ground.data.materials.append(ground_mat)
sun = bpy.data.objects.new("key", bpy.data.lights.new("key", type="SUN"))
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sun.data.angle = math.radians(8)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", type="AREA"))
scene.collection.objects.link(fill)
fill.location = (-3, -4, 4)
fill.data.size = 6

# ---------- sets ----------
SET_ROOTS = {}


def set_group(name, build):
    root = empty("set_" + name)
    build(root)
    SET_ROOTS[name] = root


def tree(p, x, z, s=1.0):
    box(0.18 * s, 1.1 * s, 0.18 * s, 0x6B4A2F, x, 0.55 * s, z, parent=p)
    sphere(0.62 * s, 0x3F8F5A, x, 1.35 * s, z, 0.8, parent=p)


def house(p, x, z, color):
    box(1.4, 1.2, 1, color, x, 0.6, z, 0.8, parent=p)
    box(1.5, 0.15, 1.1, 0x8A3B2A, x, 1.28, z, parent=p)
    box(0.36, 0.6, 0.04, 0x5A3A22, x, 0.3, z + 0.52, parent=p)


set_group("home", lambda p: (box(7, 3.2, 0.2, 0xE9D8BF, 0, 1.6, -1.6, 0.9, p), box(0.7, 1.3, 0.08, 0x8A5A32, -1.6, 0.66, -1.48, parent=p), box(1.0, 0.7, 0.06, 0x9FD3E6, 1.4, 1.75, -1.48, 0.2, p), box(1.6, 0.5, 0.7, 0x7B5E45, 1.6, 0.25, -0.9, parent=p)))
set_group("bank", lambda p: (box(9, 0.08, 1.8, 0x2F6F8F, 0, 0.02, 1.25, 0.15, p), tree(p, -2.6, -1.2), tree(p, 2.4, -1.6, 1.2)))
set_group("lane", lambda p: (box(9, 0.04, 1.2, 0x3A4150, 0, 0.02, 1.0, 0.85, p), house(p, -2.4, -1.6, 0xD98F5B), house(p, 2.2, -1.8, 0x6FA8A0)))
set_group("room", lambda p: (box(7, 3.2, 0.2, 0xCFE0D2, 0, 1.6, -1.6, 0.9, p), box(1.8, 0.08, 0.9, 0x8A6A4A, 1.5, 0.75, -0.8, parent=p), box(1.1, 0.8, 0.05, 0xFFD36A, -1.6, 1.8, -1.48, 0.3, p)))
set_group("street", lambda p: [box(9, 0.05, 2.2, 0x55595F, 0, 0.02, 0.9, 0.9, p)] + [box(1.2, 1.4 + (i % 3) * 0.6, 1, [0xD98F5B, 0x6FA8A0, 0xE5C76B, 0x9C7BB8, 0xC65D5D][i], -3.2 + i * 1.6, 0.7 + (i % 3) * 0.3, -2, parent=p) for i in range(5)])
set_group("park", lambda p: (tree(p, -2.2, -1.2, 1.2), tree(p, 2.5, -1.8, 1.4), tree(p, 0.4, -2.6), box(1.4, 0.08, 0.4, 0x9A6B3F, 1.6, 0.42, -0.4, parent=p)))
set_group("school", lambda p: (box(7, 3.2, 0.2, 0xF1E3C6, 0, 1.6, -1.6, 0.9, p), box(2.6, 1.2, 0.05, 0x24493A, 0, 1.75, -1.48, 0.5, p), box(0.9, 0.06, 0.5, 0xB08A5C, -1.8, 0.6, -0.5, parent=p), box(0.9, 0.06, 0.5, 0xB08A5C, 1.8, 0.6, -0.5, parent=p)))
set_group("office", lambda p: [box(7, 3.2, 0.2, 0xDFE4EA, 0, 1.6, -1.6, 0.9, p), box(2.0, 0.08, 0.8, 0x4A4F57, 1.4, 0.78, -0.8, parent=p)] + [box(0.8, 1.6, 0.05, 0x9FC3E6, -2.2 + i * 0.9, 1.9, -1.48, 0.15, p) for i in range(3)])
set_group("night", lambda p: (sphere(0.4, 0xFFF1C4, 2.2, 3.4, -5, 0.2, p), house(p, -2.3, -1.8, 0x3A4060)))
set_group("market", lambda p: [box(1.6, 0.7, 0.8, 0x8A6A4A, -2.4 + i * 2.4, 0.35, -1.2, parent=p) for i in range(3)] + [box(1.8, 0.06, 1.1, [0xE07A3D, 0x2A9D8F, 0xFFD36A][i], -2.4 + i * 2.4, 1.6, -1.1, parent=p) for i in range(3)])

SET_LIGHT = {"home": (0x2A1D14, 1.0, 3.5), "bank": (0x1C2A33, 1.0, 3.5), "lane": (0x1F2433, 1.0, 3.2), "room": (0x1D2A24, 1.0, 3.2), "street": (0x232831, 1.0, 3.5),
             "park": (0x8FC7E8, 1.2, 4.0), "school": (0x2A2418, 1.0, 3.2), "office": (0x1F262E, 1.0, 3.0), "night": (0x0B1024, 0.6, 2.0), "market": (0x31220F, 1.1, 3.6)}


# ---------- performers ----------
def actor(look, index):
    scale = {"child": 0.82, "elder": 0.96}.get(look["build"], 1.0)
    root = empty("actor%d" % index)
    root.scale = (scale, scale, scale)
    body = empty("body%d" % index, 0, 1.15, 0, root)
    torso = sphere(0.3, look["top"], 0, 1.15, 0, 0.4, root)
    torso.scale = (0.95, 0.8, 1.35)
    torso.parent = body
    torso.location = (0, 0, 0)
    if look["outfit"] in ("dress", "saree"):
        lower = cylinder(0.2, 0.42 if look["outfit"] == "saree" else 0.46, 0.95 if look["outfit"] == "saree" else 0.55, look["top"] if look["outfit"] == "saree" else look["bottom"], 0, 0.5 if look["outfit"] == "saree" else 0.72, 0, root)
    else:
        lower = cylinder(0.27, 0.32 if look["outfit"] == "kurta" else 0.25, 0.62 if look["outfit"] == "kurta" else 0.42, look["top"] if look["outfit"] == "kurta" else look["bottom"], 0, 0.72 if look["outfit"] == "kurta" else 0.77, 0, root)
    head = empty("head%d" % index, 0, 0.62, 0, body)
    face = sphere(0.34, look["skin"], 0, 0, 0, 0.45, head)
    face.location = (0, 0, 0)
    if look["hairStyle"] != "bald":
        hair = sphere(0.37, look["hair"], 0, 0.06, -0.04, 0.55, head)
        hair.location = (0, 0.04, 0.06)
        hair.scale = (1, 1, 0.9 if look["hairStyle"] == "short" else 1.05)
        if look["hairStyle"] in ("long", "ponytail", "bun"):
            extra = sphere(0.15 if look["hairStyle"] == "bun" else 0.22, look["hair"], 0, 0, 0, 0.55, head)
            extra.location = (0, 0.32, 0.2 if look["hairStyle"] == "bun" else -0.2)
    for x in (-0.11, 0.11):
        eye = sphere(0.045, 0x2A2238, 0, 0, 0, 0.4, head)
        eye.location = (x, -0.29, 0.04)
    mouth = sphere(0.07, 0x8A3050, 0, 0, 0, 0.35, head)
    mouth.location = (0, -0.28, -0.12)
    mouth.scale = (1.4, 0.4, 0.28)
    if look["accessory"] == "glasses":
        for x in (-0.11, 0.11):
            bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.012, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
            ring = bpy.context.active_object
            add(ring, mat(0x111111, 0.3), head)
            ring.location = (x, -0.32, 0.04)
    sleeve = look["top"] if look["outfit"] in ("kurta", "saree") else look["skin"]
    arm_l = empty("armL%d" % index, -0.4, 0.25, 0, body)
    arm_r = empty("armR%d" % index, 0.4, 0.25, 0, body)
    for arm in (arm_l, arm_r):
        limb = sphere(0.07, sleeve, 0, 0, 0, 0.45, arm)
        limb.location = (0, 0, -0.25)
        limb.scale = (1, 1, 4)
    legs = look["bottom"] if look["outfit"] in ("pants", "kurta") else look["skin"]
    leg_l = empty("legL%d" % index, -0.14, 0.5, 0, root)
    leg_r = empty("legR%d" % index, 0.14, 0.5, 0, root)
    for leg in (leg_l, leg_r):
        limb = sphere(0.08, legs, 0, 0, 0, 0.5, leg)
        limb.location = (0, 0, -0.25)
        limb.scale = (1, 1, 3.2)
    return {"root": root, "body": body, "head": head, "mouth": mouth, "armL": arm_l, "armR": arm_r, "legL": leg_l, "legR": leg_r}


CAST = DATA.get("cast") or [{"skin": "#eac3a0", "hair": "#2b1a12", "hairStyle": "ponytail", "top": "#e07a3d", "bottom": "#e07a3d", "outfit": "dress", "build": "child", "accessory": "none"}]
ACTORS = [actor(look, i) for i, look in enumerate(CAST[:3])]

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50 if PORTRAIT else 35
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = empty("target")
track = cam.constraints.new(type="TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"

SHOT = {"wide": 11.5 if PORTRAIT else 9.8, "medium": 9.4 if PORTRAIT else 8.0, "close": 6.6 if PORTRAIT else 5.8}


def open_at(t):
    value = 0.06
    for at, amount in DATA["mouth"]:
        if at > t:
            break
        value = amount
    return value


def pose(a, action, local, span, opening, x, facing):
    u = 0 if span <= 0 else min(1, max(0, local / span))
    root_x, root_y, rot = x, 0.0, facing
    body_y, head_y, head_x = 1.15, 0.0, 0.0
    arm_l, arm_r, arm_r_x, arm_l_x, leg_l, leg_r = 0.18, -0.18, 0.0, 0.0, 0.0, 0.0
    if action == "walk":
        root_x = x + (u * 2 - 1) * (0.16 if abs(x) > 0.2 else 0.28)
        leg_l, leg_r = math.sin(local * 8) * 0.65, math.sin(local * 8 + math.pi) * 0.65
        arm_l_x, arm_r_x = math.sin(local * 8 + math.pi) * 0.4, math.sin(local * 8) * 0.4
        head_y = math.sin(local * 2) * 0.22
    elif action == "turn":
        rot = facing - 0.2 + u * 0.85
        head_y = math.sin(local * 2.4) * 0.4
    elif action == "wave":
        arm_r = -0.5 - abs(math.sin(local * 7)) * 1.25
    elif action == "point":
        arm_r = -1.35
        head_y = 0.35
    elif action == "sit":
        body_y, leg_l, leg_r = 0.82, -1.4, -1.4
    elif action == "jump":
        hop = abs(math.sin(local * 4.2))
        root_y, arm_l, arm_r = hop * 0.35, 0.4 + hop, -0.4 - hop
    elif action == "hold":
        root_y = math.sin(local * 1.5) * 0.045
        head_y = math.sin(local * 0.8) * 0.16
    else:
        head_y = math.sin(local * 1.6) * 0.32
        head_x = math.sin(local * 2.3) * 0.09
        arm_r = -0.18 - max(0, math.sin(local * 2.1)) * 0.35 * opening
    a["root"].location = (root_x, 0, root_y)
    a["root"].rotation_euler = (0, 0, rot)
    a["body"].location = (0, 0, body_y)
    a["head"].rotation_euler = (head_x, 0, head_y)
    a["armL"].rotation_euler = (arm_l_x, arm_l, 0)
    a["armR"].rotation_euler = (arm_r_x, arm_r, 0)
    a["legL"].rotation_euler = (leg_l, 0, 0)
    a["legR"].rotation_euler = (leg_r, 0, 0)
    a["mouth"].scale = (1.4, 0.4, 0.18 + opening * 1.15)


def key_all(frame):
    for a in ACTORS:
        a["root"].keyframe_insert("location", frame=frame)
        a["root"].keyframe_insert("rotation_euler", frame=frame)
        a["root"].keyframe_insert("hide_render", frame=frame)
        a["body"].keyframe_insert("location", frame=frame)
        for part in ("head", "armL", "armR", "legL", "legR"):
            a[part].keyframe_insert("rotation_euler", frame=frame)
        a["mouth"].keyframe_insert("scale", frame=frame)
    cam.keyframe_insert("location", frame=frame)
    target.keyframe_insert("location", frame=frame)


def set_hidden(obj, hidden, frame):
    obj.hide_render = hidden
    obj.keyframe_insert("hide_render", frame=frame)
    for child in obj.children_recursive:
        child.hide_render = hidden
        child.keyframe_insert("hide_render", frame=frame)


def shot_at(t):
    current = DATA["scenes"][0]
    for s in DATA["scenes"]:
        if s["start"] <= t < s["end"] + 0.001:
            current = s
    return current


last_set = None
for frame in range(1, FRAMES + 1):
    t = (frame - 1) / FPS
    s = shot_at(t)
    action = s["action"] if s["action"] in ACTIONS else "talk"
    stage_set = s["set"] if s["set"] in SETS else "home"
    if stage_set != last_set:
        for name, root in SET_ROOTS.items():
            set_hidden(root, name != stage_set, frame)
        light = SET_LIGHT[stage_set]
        bg.inputs[0].default_value = (*int_rgb(light[0]), 1)
        bg.inputs[1].default_value = light[1]
        bg.inputs[0].keyframe_insert("default_value", frame=frame)
        bg.inputs[1].keyframe_insert("default_value", frame=frame)
        sun.data.energy = light[2]
        sun.data.keyframe_insert("energy", frame=frame)
        ground_color = 0x5F9A4A if stage_set == "park" else 0x1A1D2C if stage_set == "night" else (0x243056 if s["look"] == "cartoon" else 0x3D2B1F)
        node = ground_mat.node_tree.nodes.get("Principled BSDF")
        node.inputs["Base Color"].default_value = (*int_rgb(ground_color), 1)
        node.inputs["Base Color"].keyframe_insert("default_value", frame=frame)
        last_set = stage_set
    span = max(0.2, s["end"] - s["start"])
    local = max(0.0, t - s["start"])
    along = min(1.0, local / span)
    opening = open_at(t)
    on = [i for i in s["on"] if 0 <= i < len(ACTORS)] or [0]
    spread = 0.95 if len(on) == 3 else 0.5

    def x_of(slot):
        return 0 if len(on) == 1 else (slot - (len(on) - 1) / 2) * spread * 2

    for i, a in enumerate(ACTORS):
        a["root"].hide_render = i not in on
    for slot, index in enumerate(on):
        x = x_of(slot)
        facing = 0 if len(on) == 1 else (-0.28 if x < 0 else 0.28)
        speaking = s["speaker"] == index or (s["speaker"] == -1 and slot == 0)
        act = action if slot == 0 or action in ("walk", "jump") else "talk"
        pose(ACTORS[index], act, local + slot * 0.37, span, opening if speaking else 0.04, x, facing)
    dist = SHOT.get(s["shot"], SHOT["medium"])
    look_y = 1.45 if s["shot"] == "close" else (1.15 if PORTRAIT else 1.05)
    focus = x_of(on.index(s["speaker"])) * 0.6 if s["shot"] == "close" and s["speaker"] in on else 0
    cam.location = (focus + math.sin(t * 0.2) * 0.08, -(dist - along * 0.45), look_y + 0.35)
    target.location = (focus, 0, look_y)
    key_all(frame)

def all_fcurves(action):
    # Blender 4.x keeps curves on the action; Blender 5 keeps them in layers, strips and channel bags.
    curves = list(getattr(action, "fcurves", []) or [])
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            for bag in getattr(strip, "channelbags", []) or []:
                curves.extend(bag.fcurves)
    return curves


# Every frame is keyed, so hold each value until the next frame: sets, light and colour cut on the beat.
for action in bpy.data.actions:
    for curve in all_fcurves(action):
        for point in curve.keyframe_points:
            point.interpolation = "CONSTANT"

bpy.ops.render.render(animation=True)
