// EPIC 026 rule R2 / decision 3: hash routing, so no deployment mode needs a
// server rewrite and `GET /nope` keeps its pinned `404 unknown_route`.
// EPIC 026 ships exactly one page; the shells and workspaces are 026.1 onward.
import { createHashRouter } from "react-router-dom";
import { HealthPage } from "@/pages/health";

export const router = createHashRouter([
  {
    path: "/",
    element: <HealthPage />,
  },
]);
