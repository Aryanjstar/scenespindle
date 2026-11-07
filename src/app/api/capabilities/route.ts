import { json } from "../../../server/guard";
import { capabilities } from "../../../server/capabilities";

/** Same answer as /api/catalog, under the name docs/API.md uses. */
export async function GET() {
  return json(capabilities());
}
