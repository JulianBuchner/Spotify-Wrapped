import { createRouter, createWebHistory } from "vue-router";
import DashboardView from "./views/DashboardView.vue";
import CloudView from "./views/CloudView.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "dashboard", component: DashboardView },
    { path: "/cloud", name: "cloud", component: CloudView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
