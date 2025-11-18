<template>
  <div class="group relative">
    <!-- Display mode: show coordinates with map icon -->
    <div
      v-if="!showModal"
      class="px-3 py-2 cursor-pointer hover:bg-base-200 rounded transition-colors flex items-center gap-2"
      @click="openModal"
    >
      <span class="tabular-nums">
        {{ displayValue }}
      </span>
      <svg class="w-4 h-4 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </div>

    <!-- Modal with map -->
    <dialog ref="modalRef" class="modal" :class="{ 'modal-open': showModal }">
      <div class="modal-box w-11/12 max-w-4xl">
        <h3 class="font-bold text-lg mb-4">{{ isLatitude ? 'Latitude' : 'Longitude' }}</h3>

        <!-- Coordinate input -->
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Enter {{ isLatitude ? 'Latitude' : 'Longitude' }}</span>
          </label>
          <input
            v-model.number="editValue"
            type="number"
            step="0.000001"
            :min="isLatitude ? -90 : -180"
            :max="isLatitude ? 90 : 180"
            class="input input-bordered"
            @input="updateMapPosition"
          />
          <label class="label">
            <span class="label-text-alt">
              Valid range: {{ isLatitude ? '-90 to 90' : '-180 to 180' }}
            </span>
          </label>
        </div>

        <!-- Map container -->
        <div ref="mapContainer" class="w-full h-96 rounded-lg border border-base-300"></div>

        <!-- Actions -->
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="handleCancel">
            Cancel
          </button>
          <button type="button" class="btn btn-primary" @click="handleSave">
            Save
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="handleCancel">
        <button type="button">close</button>
      </form>
    </dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  modelValue: {
    type: Number,
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  },
  columnName: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const showModal = ref(false)
const editValue = ref(props.modelValue)
const mapContainer = ref(null)
const modalRef = ref(null)
let map = null
let marker = null

const isLatitude = computed(() => {
  const name = props.columnName.toLowerCase()
  return name.includes('lat') && !name.includes('lng') && !name.includes('lon')
})

const displayValue = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined) return '—'
  return props.modelValue.toFixed(6)
})

watch(() => props.modelValue, (newVal) => {
  editValue.value = newVal
})

async function openModal() {
  if (props.readonly) return
  showModal.value = true
  editValue.value = props.modelValue

  await nextTick()
  initializeMap()
}

function initializeMap() {
  if (!mapContainer.value || map) return

  // Default center (can be customized)
  const lat = isLatitude.value ? (editValue.value || 0) : 0
  const lng = !isLatitude.value ? (editValue.value || 0) : 0

  map = L.map(mapContainer.value).setView([lat, lng], 10)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map)

  marker = L.marker([lat, lng], {
    draggable: true
  }).addTo(map)

  // Update coordinate when marker is dragged
  marker.on('dragend', (event) => {
    const position = event.target.getLatLng()
    if (isLatitude.value) {
      editValue.value = position.lat
    } else {
      editValue.value = position.lng
    }
  })

  // Allow clicking map to set position
  map.on('click', (event) => {
    const { lat, lng } = event.latlng
    marker.setLatLng([lat, lng])
    if (isLatitude.value) {
      editValue.value = lat
    } else {
      editValue.value = lng
    }
  })
}

function updateMapPosition() {
  if (!map || !marker) return

  const lat = isLatitude.value ? (editValue.value || 0) : 0
  const lng = !isLatitude.value ? (editValue.value || 0) : 0

  marker.setLatLng([lat, lng])
  map.panTo([lat, lng])
}

function handleSave() {
  showModal.value = false
  if (map) {
    map.remove()
    map = null
    marker = null
  }

  if (editValue.value !== props.modelValue) {
    emit('update:modelValue', editValue.value)
    emit('save', editValue.value)
  }
}

function handleCancel() {
  showModal.value = false
  if (map) {
    map.remove()
    map = null
    marker = null
  }
  editValue.value = props.modelValue
}
</script>
