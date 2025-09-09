// Entity icon imports
import { markRaw } from 'vue'
import MapPinIcon from 'feather-icons/dist/icons/map-pin.svg?component'
import UsersIcon from 'feather-icons/dist/icons/users.svg?component'

export const uiConfig = {
  // Primary navigation entities
  primary: ['venues', 'users'],

  // Display preferences
  display: {
    'venues': 'table',
    'users': 'cards'
  },

  // Entity icons (direct component references marked as raw to prevent reactivity)
  icons: {
    'venues': markRaw(MapPinIcon),
    'users': markRaw(UsersIcon)
  },

  // App metadata
  app: {
    name: 'ZeroQL',
    theme: 'zeroql'
  }
};
