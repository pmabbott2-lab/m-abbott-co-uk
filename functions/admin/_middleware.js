import { adminGuard } from "../_lib/admin-access.js";

export const onRequest = adminGuard;
