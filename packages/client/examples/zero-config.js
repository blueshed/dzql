/**
 * Zero-config example - the simplest possible DZQL admin setup
 */
import { createDZQLAdmin } from '../src/createDZQLAdmin.js'

// That's it! One line creates a full admin interface
const admin = createDZQLAdmin('ws://localhost:3000/ws')
admin.mount('#app')

// DZQL will:
// ✓ Connect to WebSocket
// ✓ Fetch all entity metadata
// ✓ Generate CRUD interfaces for every table
// ✓ Handle permissions automatically
// ✓ Set up real-time subscriptions
// ✓ Create forms from schema
// ✓ Enable search, sort, pagination
// ✓ Handle foreign keys and relationships
// ✓ Provide export functionality
//
// All with ZERO configuration!
