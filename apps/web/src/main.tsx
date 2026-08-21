import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { App } from "./App";
import { WhatsNewButton } from "./components/WhatsNewButton";
import { FeedbackLauncher } from "./components/FeedbackLauncher";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { initVitals } from "./lib/vitals";

initVitals();

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // `?spot=<place_id>` deep-links the carousel to a specific spot (used by /near)
  validateSearch: (search): { spot?: string } => ({
    spot: typeof search.spot === "string" ? search.spot : undefined,
  }),
  component: App,
});
const nearRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/near",
  // separate chunk: visitors landing on "/" never download the Near Me page
  component: lazyRouteComponent(() => import("./NearMe"), "NearMe"),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, nearRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const el = document.getElementById("root");
if (!el) throw new Error("#root element not found");
createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
    <WhatsNewButton />
    <FeedbackLauncher />
  </StrictMode>,
);
