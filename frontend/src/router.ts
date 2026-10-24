import { createRouter, createWebHistory } from "vue-router";
import DashboardView from "./views/DashboardView.vue";
import CloudView from "./views/CloudView.vue";
import RecordView from "./views/RecordView.vue";
import ErasView from "./views/ErasView.vue";
import GenresView from "./views/GenresView.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "dashboard", component: DashboardView },
    { path: "/cloud", name: "cloud", component: CloudView },
    { path: "/record", name: "record", component: RecordView },
    { path: "/eras", name: "eras", component: ErasView },
    { path: "/genres", name: "genres", component: GenresView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
