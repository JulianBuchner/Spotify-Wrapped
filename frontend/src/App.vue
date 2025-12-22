<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getHealth, getPlayCount } from "./api";

const status = ref("loading...");
const count = ref<number | null>(null);

onMounted(async () => {
  const h = await getHealth();
  status.value = h.status;

  const c = await getPlayCount();
  count.value = c.count;
});
</script>

<template>
  <main style="padding: 2rem">
    <h1>Anytime Wrapped</h1>
    <p>Backend: {{ status }}</p>
    <p v-if="count !== null">Plays stored: {{ count }}</p>
  </main>
</template>
