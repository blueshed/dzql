<script setup>
import { useRouter } from 'vue-router'
import { useProfileStore } from "@/stores/main"
import { useMetaStore } from "@/stores/meta"

const router = useRouter()
const profileStore = useProfileStore()
const metaStore = useMetaStore()

const capitalize = (str) => {
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const navigateToEntity = (entityName) => {
  router.push(`/${entityName}`)
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-base-content mb-2">Welcome to DZQL Admin</h1>
      <p class="text-base-content/70">
        PostgreSQL-powered framework with zero boilerplate CRUD operations
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="metaStore.loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <!-- Entities Grid -->
    <div v-else-if="metaStore.entitiesList.length > 0">
      <h2 class="text-xl font-semibold mb-4">Your Entities</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="entity in metaStore.entitiesList"
          :key="entity.table_name"
          @click="navigateToEntity(entity.table_name)"
          class="card bg-base-100 border border-base-300 hover:border-primary hover:shadow-lg transition-all cursor-pointer"
        >
          <div class="card-body">
            <div class="flex items-center gap-3 mb-2">
              <component
                :is="metaStore.getEntityIcon(entity.table_name)"
                class="w-8 h-8 text-primary"
              />
              <h3 class="card-title text-base">{{ capitalize(entity.table_name) }}</h3>
            </div>
            <div class="flex gap-1 flex-wrap">
              <span
                v-for="op in metaStore.getAvailableOperations(entity.table_name)"
                :key="op"
                class="badge badge-sm badge-outline"
              >
                {{ op }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="text-center py-12">
      <div class="text-base-content/60">
        <p class="text-lg mb-2">No entities registered yet</p>
        <p class="text-sm">Register entities in your database to get started</p>
      </div>
    </div>

    <!-- Quick Stats -->
    <div v-if="metaStore.entitiesList.length > 0" class="mt-12">
      <h2 class="text-xl font-semibold mb-4">Statistics</h2>
      <div class="stats shadow bg-base-100 w-full">
        <div class="stat">
          <div class="stat-title">Total Entities</div>
          <div class="stat-value text-primary">{{ metaStore.entitiesList.length }}</div>
          <div class="stat-desc">Registered in database</div>
        </div>

        <div class="stat">
          <div class="stat-title">Relations</div>
          <div class="stat-value text-secondary">{{ metaStore.relations.length }}</div>
          <div class="stat-desc">Foreign key relationships</div>
        </div>

        <div class="stat">
          <div class="stat-title">Operations</div>
          <div class="stat-value">{{ metaStore.operations.length }}</div>
          <div class="stat-desc">Available per entity</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
