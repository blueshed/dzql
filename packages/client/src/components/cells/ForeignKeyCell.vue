<template>
  <div class="group relative">
    <!-- Editing mode: searchable dropdown -->
    <div v-if="isEditing" class="relative">
      <input
        ref="inputRef"
        v-model="searchQuery"
        type="text"
        class="input input-sm input-bordered w-full"
        placeholder="Search..."
        @input="handleSearch"
        @blur="handleBlur"
        @keydown.enter="selectFirst"
        @keydown.esc="handleCancel"
        @keydown.down.prevent="moveDown"
        @keydown.up.prevent="moveUp"
      />

      <!-- Dropdown results -->
      <div
        v-if="results.length > 0"
        class="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
      >
        <button
          v-for="(result, index) in results"
          :key="result.id"
          type="button"
          class="w-full px-3 py-2 text-left hover:bg-base-200 transition-colors"
          :class="{ 'bg-base-200': index === selectedIndex }"
          @mousedown.prevent="selectResult(result)"
        >
          {{ result.label }}
        </button>
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="absolute right-2 top-2">
        <span class="loading loading-spinner loading-xs"></span>
      </div>
    </div>

    <!-- Display mode: show label with link -->
    <div
      v-else
      class="px-3 py-2 cursor-pointer hover:bg-base-200 rounded transition-colors flex items-center gap-2"
      @click="startEdit"
    >
      <span>{{ displayLabel || '—' }}</span>
      <button
        v-if="modelValue"
        type="button"
        class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
        @click.stop="navigateToEntity"
      >
        →
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useEntityStore } from '../../stores/entityFactory'
import { useMetaStore } from '../../stores/meta'

const props = defineProps({
  modelValue: {
    type: Number,
    default: null
  },
  referencedEntity: {
    type: String,
    required: true
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const router = useRouter()
const metaStore = useMetaStore()
const entityStore = useEntityStore(props.referencedEntity)

const isEditing = ref(false)
const searchQuery = ref('')
const results = ref([])
const loading = ref(false)
const selectedIndex = ref(0)
const inputRef = ref(null)
const displayLabel = ref('')

// Load initial display label
watch(() => props.modelValue, async (newVal) => {
  if (newVal) {
    try {
      const record = await entityStore.get(newVal)
      const labelField = metaStore.getLabelField(props.referencedEntity)
      displayLabel.value = record[labelField] || `#${newVal}`
    } catch {
      displayLabel.value = `#${newVal}`
    }
  } else {
    displayLabel.value = ''
  }
}, { immediate: true })

async function startEdit() {
  if (props.readonly) return
  isEditing.value = true
  searchQuery.value = displayLabel.value
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()

  // Show initial results
  await handleSearch()
}

async function handleSearch() {
  if (!searchQuery.value) {
    results.value = []
    return
  }

  loading.value = true
  try {
    const lookupResults = await entityStore.lookup(searchQuery.value)
    results.value = lookupResults.map(r => ({
      id: r.id,
      label: r.label
    }))
    selectedIndex.value = 0
  } catch (err) {
    console.error('Lookup error:', err)
    results.value = []
  } finally {
    loading.value = false
  }
}

function selectResult(result) {
  displayLabel.value = result.label
  isEditing.value = false
  results.value = []

  if (result.id !== props.modelValue) {
    emit('update:modelValue', result.id)
    emit('save', result.id)
  }
}

function selectFirst() {
  if (results.value.length > 0) {
    selectResult(results.value[selectedIndex.value])
  }
}

function moveDown() {
  if (selectedIndex.value < results.value.length - 1) {
    selectedIndex.value++
  }
}

function moveUp() {
  if (selectedIndex.value > 0) {
    selectedIndex.value--
  }
}

function handleBlur() {
  // Delay to allow click on dropdown
  setTimeout(() => {
    isEditing.value = false
    results.value = []
    searchQuery.value = displayLabel.value
  }, 200)
}

function handleCancel() {
  isEditing.value = false
  results.value = []
  searchQuery.value = displayLabel.value
}

function navigateToEntity() {
  if (props.modelValue) {
    router.push({
      name: 'entity-detail',
      params: {
        entity: props.referencedEntity,
        id: props.modelValue
      }
    })
  }
}
</script>
