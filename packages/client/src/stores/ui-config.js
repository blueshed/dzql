// Entity icon imports
import { markRaw } from 'vue'
import MapPinIcon from 'feather-icons/dist/icons/map-pin.svg?component'
import { BuildingOfficeIcon } from '@heroicons/vue/24/outline'

export const uiConfig = {
  // Primary navigation entities
  primary: ['venues', 'organisations'],

  // Display preferences
  display: {
    'venues': 'table',
    'organisations': 'table'
  },

  // Entity icons (direct component references marked as raw to prevent reactivity)
  icons: {
    'venues': markRaw(MapPinIcon),
    'organisations': markRaw(BuildingOfficeIcon)
  },

  // App metadata
  app: {
    name: 'DZQL',
    theme: 'dzql'
  }
};
