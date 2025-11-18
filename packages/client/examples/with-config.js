/**
 * With-config example - optional customization
 */
import '../src/style.css'
import { createDZQLAdmin } from '../src/createDZQLAdmin.js'

// Optional: Customize specific entities or UI preferences
// Use relative path - Vite will proxy to ws://localhost:3000/ws in dev mode
const admin = createDZQLAdmin('/ws', {
  // Global settings
  title: 'Venue Management System',
  theme: 'dark',

  // Entity-specific overrides (optional!)
  entities: {
    venues: {
      icon: 'building',
      label: 'Music Venues',
      list: {
        columns: ['name', 'city', 'capacity'],  // Override auto-detection
        defaultSort: 'name',
        pageSize: 50
      },
      form: {
        layout: 'two-column',
        groups: [
          {
            label: 'Basic Info',
            fields: ['name', 'city', 'address']
          },
          {
            label: 'Details',
            fields: ['capacity', 'website', 'phone']
          }
        ]
      }
    },

    // Other entities use auto-generated UI
    // No config needed!
  }
})

admin.mount('#app')

// Config is OPTIONAL - only use it to override defaults
// Everything works perfectly with zero config!
