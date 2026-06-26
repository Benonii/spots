import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { App } from "./App";
import { NearMe } from "./NearMe";
import { Admin } from "./Admin";
import { WhatsNewButton } from "./components/WhatsNewButton";
import { FeedbackLauncher } from "./components/FeedbackLauncher";
import "leaflet/dist/leaflet.css";
import "./styles.css";

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
  component: NearMe,
});
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: Admin,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, nearRoute, adminRoute]),
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
