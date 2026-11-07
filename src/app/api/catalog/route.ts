import { json } from "../../../server/guard";
import { capabilities } from "../../../server/capabilities";

/** Only implemented and configured combinations are available; the rest say why. */
export async function GET() {
  return json(capabilities());
}
