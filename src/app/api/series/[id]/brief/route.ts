import { briefHandlers } from "../../../../../server/brief-routes";

const handlers = briefHandlers("series");
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
