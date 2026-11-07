import { briefHandlers } from "../../../../../server/brief-routes";

const handlers = briefHandlers("project");
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
