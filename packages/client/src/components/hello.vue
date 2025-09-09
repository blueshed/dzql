<script setup>
import { useProfileStore } from "@/stores/main";

const store = useProfileStore();
</script>

<template>
<div>
    <div>hello</div>
    <pre>{{ store.profile }}</pre>
</div>
</template>

<style scoped>
</style>
