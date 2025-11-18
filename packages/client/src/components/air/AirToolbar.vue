<template>
  <div class="navbar bg-base-100 border-b border-base-300 px-4 gap-2">
    <!-- Left side: Entity name -->
    <div class="navbar-start">
      <h1 class="text-xl font-bold">{{ entityTitle }}</h1>
    </div>

    <!-- Center: Search and actions -->
    <div class="navbar-center flex-1 flex gap-2">
      <!-- Search box -->
      <div class="form-control flex-1 max-w-2xl">
        <div class="join">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search records..."
            class="input input-bordered input-sm join-item w-full min-w-3xs"
            @input="handleSearch"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="btn btn-sm btn-ghost join-item"
            @click="clearSearch"
            title="Clear search"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Filter button -->
      <button
        type="button"
        class="btn btn-sm btn-ghost gap-1"
        :class="{ 'btn-active': hasActiveFilters }"
        @click="toggleFilters"
        title="Filter records"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>Filter</span>
        <div v-if="filterCount > 0" class="badge badge-primary badge-sm">{{ filterCount }}</div>
      </button>

      <!-- Sort button -->
      <button
        type="button"
        class="btn btn-sm btn-ghost gap-1"
        :class="{ 'btn-active': hasActiveSort }"
        @click="toggleSort"
        title="Sort records"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <span>Sort</span>
        <div v-if="sortCount > 0" class="badge badge-primary badge-sm">{{ sortCount }}</div>
      </button>

      <!-- Column visibility button -->
      <div class="dropdown dropdown-end">
        <button
          tabindex="0"
          type="button"
          class="btn btn-sm btn-ghost gap-1"
          title="Show/hide columns"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <span>Columns</span>
        </button>
        <div
          tabindex="0"
          class="dropdown-content menu bg-base-100 rounded-box z-50 w-52 p-2 shadow-lg border border-base-300 max-h-96 overflow-y-auto"
        >
          <li v-for="column in availableColumns" :key="column.name" class="hover-bordered">
            <label class="label cursor-pointer justify-start gap-2 py-2">
              <input
                type="checkbox"
                :checked="!hiddenColumns.includes(column.name)"
                @change="toggleColumn(column.name)"
                class="checkbox checkbox-sm"
              />
              <span class="label-text">{{ column.label }}</span>
            </label>
          </li>
          <div class="divider my-1"></div>
          <li>
            <button @click="showAllColumns" class="text-sm">
              Show all columns
            </button>
          </li>
        </div>
      </div>

      <!-- Row height selector -->
      <div class="dropdown dropdown-end">
        <button
          tabindex="0"
          type="button"
          class="btn btn-sm btn-ghost gap-1"
          title="Row height"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </button>
        <ul
          tabindex="0"
          class="dropdown-content menu bg-base-100 rounded-box z-50 w-40 p-2 shadow-lg border border-base-300"
        >
          <li>
            <button
              @click="setRowHeight('compact')"
              :class="{ 'active': rowHeight === 'compact' }"
              class="text-sm"
            >
              Compact
            </button>
          </li>
          <li>
            <button
              @click="setRowHeight('normal')"
              :class="{ 'active': rowHeight === 'normal' }"
              class="text-sm"
            >
              Normal
            </button>
          </li>
          <li>
            <button
              @click="setRowHeight('expanded')"
              :class="{ 'active': rowHeight === 'expanded' }"
              class="text-sm"
            >
              Expanded
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- Right side: Add record button -->
    <div class="navbar-end">
      <button
        type="button"
        class="btn btn-sm btn-primary gap-1"
        @click="openAddRecord"
        title="Add new record"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Add Record</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  entity: {
    type: String,
    required: true
  },
  availableColumns: {
    type: Array,
    default: () => []
  },
  hiddenColumns: {
    type: Array,
    default: () => []
  },
  filterCount: {
    type: Number,
    default: 0
  },
  sortCount: {
    type: Number,
    default: 0
  },
  rowHeight: {
    type: String,
    default: 'normal',
    validator: (value) => ['compact', 'normal', 'expanded'].includes(value)
  }
})

const emit = defineEmits([
  'add-record',
  'search',
  'clear-search',
  'toggle-filters',
  'toggle-sort',
  'toggle-column',
  'show-all-columns',
  'set-row-height'
])

const searchQuery = ref('')

const entityTitle = computed(() => {
  return props.entity
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
})

const hasActiveFilters = computed(() => props.filterCount > 0)
const hasActiveSort = computed(() => props.sortCount > 0)

function handleSearch() {
  emit('search', searchQuery.value)
}

function clearSearch() {
  searchQuery.value = ''
  emit('clear-search')
}

function openAddRecord() {
  emit('add-record')
}

function toggleFilters() {
  emit('toggle-filters')
}

function toggleSort() {
  emit('toggle-sort')
}

function toggleColumn(columnName) {
  emit('toggle-column', columnName)
}

function showAllColumns() {
  emit('show-all-columns')
}

function setRowHeight(height) {
  emit('set-row-height', height)
}
</script>
