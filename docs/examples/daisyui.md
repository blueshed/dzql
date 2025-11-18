# daisyUI v5 Context Documentation

## Overview
daisyUI is a CSS component library for Tailwind CSS that provides semantic class names for common UI components. It acts as a high-level abstraction over Tailwind's utility classes, allowing developers to use component names like `btn`, `card`, `modal` instead of writing multiple utility classes.

## daisyUI v5 Key Features

### Tailwind CSS 4 Integration
- Built for Tailwind CSS 4 with native plugin API support
- Pure CSS files for components and themes
- Selective component imports (only include what you need)
- Better tree-shaking and smaller bundle sizes

### Installation & Setup
```css
/* Basic setup in CSS file */
@import "tailwindcss";
@plugin "daisyui";
```

```css
/* With custom themes */
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark, cupcake;
}
```

### Core Concepts

#### Semantic Color System
daisyUI provides semantic color names that adapt across themes:

**Primary Colors:**
- `primary` - Primary brand color
- `primary-content` - Foreground content for primary backgrounds
- `secondary` - Secondary brand color
- `secondary-content` - Foreground content for secondary backgrounds
- `accent` - Accent brand color
- `accent-content` - Foreground content for accent backgrounds

**Neutral Colors:**
- `neutral` - Neutral dark color
- `neutral-content` - Foreground content for neutral backgrounds

**Base Colors:**
- `base-100` - Base surface color (blank backgrounds)
- `base-200` - Base color, darker shade
- `base-300` - Base color, even darker shade
- `base-content` - Foreground content for base colors

**Status Colors:**
- `info` / `info-content` - Informational messages
- `success` / `success-content` - Success states
- `warning` / `warning-content` - Warning states
- `error` / `error-content` - Error states

#### Usage with Tailwind Classes
```html
<!-- daisyUI semantic colors work with all Tailwind utilities -->
<div class="bg-primary text-primary-content">Primary background</div>
<div class="border-secondary">Secondary border</div>
<div class="text-accent/60">Accent text with opacity</div>
```

## Components Reference

### Avatar Component
Used for displaying user profile images and placeholders.

```html
<!-- Basic avatar -->
<div class="avatar">
  <div class="w-24 rounded">
    <img src="https://example.com/avatar.jpg" />
  </div>
</div>

<!-- Avatar with online indicator -->
<div class="avatar online">
  <div class="w-16 rounded-full">
    <img src="https://example.com/avatar.jpg" />
  </div>
</div>

<!-- Avatar placeholder -->
<div class="avatar placeholder">
  <div class="bg-neutral text-neutral-content w-16 rounded-full">
    <span class="text-xl">JD</span>
  </div>
</div>

<!-- Avatar with custom masks -->
<div class="avatar">
  <div class="mask mask-heart w-24">
    <img src="https://example.com/avatar.jpg" />
  </div>
</div>

<!-- Avatar group -->
<div class="avatar-group -space-x-6 rtl:space-x-reverse">
  <div class="avatar">
    <div class="w-12">
      <img src="avatar1.jpg" />
    </div>
  </div>
  <div class="avatar">
    <div class="w-12">
      <img src="avatar2.jpg" />
    </div>
  </div>
</div>
```

**Vue Usage:**
```vue
<template>
  <div class="avatar" :class="{ online: user.is_online }">
    <div class="w-16 rounded-full">
      <img :src="user.avatar_url" :alt="user.name" />
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  user: {
    type: Object,
    required: true
  }
})
</script>
```

### Button Component
```html
<!-- Basic button -->
<button class="btn">Button</button>

<!-- Button variants -->
<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-accent">Accent</button>
<button class="btn btn-ghost">Ghost</button>
<button class="btn btn-outline">Outline</button>

<!-- Button sizes -->
<button class="btn btn-xs">Extra small</button>
<button class="btn btn-sm">Small</button>
<button class="btn btn-md">Medium (default)</button>
<button class="btn btn-lg">Large</button>
<button class="btn btn-xl">Extra large</button>

<!-- Button states -->
<button class="btn btn-primary" disabled>Disabled</button>
<button class="btn btn-primary loading">
  <span class="loading loading-spinner"></span>
  Loading
</button>
```

### Card Component
```html
<div class="card w-96 bg-base-100 shadow-xl">
  <figure>
    <img src="image.jpg" alt="Image" />
  </figure>
  <div class="card-body">
    <h2 class="card-title">Card Title</h2>
    <p>Card content goes here</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Action</button>
    </div>
  </div>
</div>

<!-- Compact card -->
<div class="card card-compact w-96 bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">Compact Card</h2>
    <p>This card uses less padding</p>
  </div>
</div>
```

### Modal Component
```html
<!-- Modal trigger -->
<button class="btn" onclick="my_modal_1.showModal()">Open Modal</button>

<!-- Modal -->
<dialog id="my_modal_1" class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg">Modal Title</h3>
    <p class="py-4">Modal content</p>
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">Close</button>
        <button class="btn btn-primary">Save</button>
      </form>
    </div>
  </div>
</dialog>

<!-- Modal with backdrop -->
<dialog id="my_modal_2" class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg">Modal Title</h3>
    <p class="py-4">Click outside to close</p>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
```

**Vue Modal Pattern:**
```vue
<template>
  <dialog ref="modal" class="modal">
    <div class="modal-box">
      <h3 class="font-bold text-lg">{{ title }}</h3>
      <slot></slot>
      <div class="modal-action">
        <button class="btn" @click="close">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps(['title'])
const emit = defineEmits(['save', 'close'])
const modal = ref(null)

const open = () => modal.value.showModal()
const close = () => {
  modal.value.close()
  emit('close')
}
const save = () => {
  emit('save')
  close()
}

defineExpose({ open })
</script>
```

### Dropdown Component
```html
<!-- Basic dropdown -->
<div class="dropdown">
  <div tabindex="0" role="button" class="btn m-1">Click</div>
  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow">
    <li><a>Item 1</a></li>
    <li><a>Item 2</a></li>
  </ul>
</div>

<!-- Dropdown end -->
<div class="dropdown dropdown-end">
  <div tabindex="0" role="button" class="btn">Dropdown</div>
  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow">
    <li><a>Item 1</a></li>
    <li><a>Item 2</a></li>
  </ul>
</div>

<!-- Helper dropdown -->
<div class="dropdown dropdown-end">
  <div tabindex="0" role="button" class="btn btn-circle btn-ghost btn-xs text-info">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-4 w-4 stroke-current">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
  </div>
  <div class="card card-sm dropdown-content bg-base-100 rounded-box z-1 w-64 shadow">
    <div class="card-body">
      <h2 class="card-title">Need help?</h2>
      <p>Here is additional information</p>
    </div>
  </div>
</div>
```

### Navbar Component
```html
<div class="navbar bg-base-100 shadow-sm">
  <div class="navbar-start">
    <a class="btn btn-ghost text-xl">daisyUI</a>
  </div>
  <div class="navbar-center hidden lg:flex">
    <ul class="menu menu-horizontal px-1">
      <li><a>Link</a></li>
      <li>
        <details>
          <summary>Parent</summary>
          <ul class="p-2">
            <li><a>Submenu 1</a></li>
            <li><a>Submenu 2</a></li>
          </ul>
        </details>
      </li>
    </ul>
  </div>
  <div class="navbar-end">
    <!-- Search -->
    <input type="text" placeholder="Search" class="input input-bordered w-24 md:w-auto" />

    <!-- User dropdown -->
    <div class="dropdown dropdown-end">
      <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
        <div class="w-10 rounded-full">
          <img src="avatar.jpg" alt="User avatar" />
        </div>
      </div>
      <ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
        <li>
          <a class="justify-between">
            Profile
            <span class="badge">New</span>
          </a>
        </li>
        <li><a>Settings</a></li>
        <li><a>Logout</a></li>
      </ul>
    </div>
  </div>
</div>
```

### Menu Component
```html
<!-- Basic menu -->
<ul class="menu bg-base-200 rounded-box w-56">
  <li><a>Item 1</a></li>
  <li><a>Item 2</a></li>
  <li><a>Item 3</a></li>
</ul>

<!-- Menu with submenu (details/summary) -->
<ul class="menu bg-base-200 rounded-box w-56">
  <li><a>Item 1</a></li>
  <li>
    <details open>
      <summary>Parent</summary>
      <ul>
        <li><a>Submenu 1</a></li>
        <li><a>Submenu 2</a></li>
      </ul>
    </details>
  </li>
  <li><a>Item 3</a></li>
</ul>

<!-- Horizontal menu with icons -->
<ul class="menu menu-horizontal bg-base-200 rounded-box">
  <li>
    <a class="tooltip" data-tip="Home">
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    </a>
  </li>
</ul>
```

### Drawer (Sidebar) Component
```html
<div class="drawer">
  <input id="drawer-toggle" type="checkbox" class="drawer-toggle" />
  <div class="drawer-content">
    <!-- Page content -->
    <label for="drawer-toggle" class="btn btn-primary drawer-button">Open drawer</label>
  </div>
  <div class="drawer-side">
    <label for="drawer-toggle" aria-label="close sidebar" class="drawer-overlay"></label>
    <ul class="menu bg-base-200 text-base-content min-h-full w-80 p-4">
      <li><a>Sidebar Item 1</a></li>
      <li><a>Sidebar Item 2</a></li>
    </ul>
  </div>
</div>

<!-- Right-side drawer -->
<div class="drawer drawer-end">
  <input id="drawer-toggle-end" type="checkbox" class="drawer-toggle" />
  <div class="drawer-content">
    <label for="drawer-toggle-end" class="btn btn-primary">Open right drawer</label>
  </div>
  <div class="drawer-side">
    <label for="drawer-toggle-end" aria-label="close sidebar" class="drawer-overlay"></label>
    <ul class="menu bg-base-200 text-base-content min-h-full w-80 p-4">
      <li><a>Right Sidebar Item</a></li>
    </ul>
  </div>
</div>
```

### Tabs Component
```html
<!-- Basic tabs with radio inputs -->
<div class="tabs tabs-box">
  <input type="radio" name="my_tabs_1" class="tab" aria-label="Tab 1" />
  <input type="radio" name="my_tabs_1" class="tab" aria-label="Tab 2" checked="checked" />
  <input type="radio" name="my_tabs_1" class="tab" aria-label="Tab 3" />
</div>

<!-- Tabs with content -->
<div class="tabs tabs-border">
  <input type="radio" name="my_tabs_2" class="tab" aria-label="Tab 1" />
  <div class="tab-content bg-base-100 border-base-300 p-6">Tab content 1</div>

  <input type="radio" name="my_tabs_2" class="tab" aria-label="Tab 2" checked="checked" />
  <div class="tab-content bg-base-100 border-base-300 p-6">Tab content 2</div>

  <input type="radio" name="my_tabs_2" class="tab" aria-label="Tab 3" />
  <div class="tab-content bg-base-100 border-base-300 p-6">Tab content 3</div>
</div>

<!-- Lifted tabs with icons -->
<div class="tabs tabs-lift">
  <label class="tab">
    <input type="radio" name="my_tabs_3" />
    <svg class="size-4 me-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
    </svg>
    Live
  </label>
  <div class="tab-content bg-base-100 border-base-300 p-6">Tab content 1</div>
</div>
```

### Accordion (Collapse) Component
```html
<!-- Basic accordion -->
<div class="collapse bg-base-100 border border-base-300">
  <input type="radio" name="my-accordion-1" checked="checked" />
  <div class="collapse-title font-semibold">How do I create an account?</div>
  <div class="collapse-content text-sm">
    Click the "Sign Up" button and follow the registration process.
  </div>
</div>

<!-- Accordion with arrow -->
<div class="collapse collapse-arrow bg-base-100 border border-base-300">
  <input type="radio" name="my-accordion-2" />
  <div class="collapse-title font-semibold">How do I reset my password?</div>
  <div class="collapse-content text-sm">
    Click "Forgot Password" on the login page.
  </div>
</div>

<!-- Accordion with plus/minus -->
<div class="collapse collapse-plus bg-base-100 border border-base-300">
  <input type="radio" name="my-accordion-3" />
  <div class="collapse-title font-semibold">How do I update my profile?</div>
  <div class="collapse-content text-sm">
    Go to Settings and select "Edit Profile".
  </div>
</div>

<!-- Joined accordion -->
<div class="join join-vertical bg-base-100">
  <div class="collapse collapse-arrow join-item border-base-300 border">
    <input type="radio" name="my-accordion-4" checked="checked" />
    <div class="collapse-title font-semibold">Section 1</div>
    <div class="collapse-content text-sm">Content 1</div>
  </div>
  <div class="collapse collapse-arrow join-item border-base-300 border">
    <input type="radio" name="my-accordion-4" />
    <div class="collapse-title font-semibold">Section 2</div>
    <div class="collapse-content text-sm">Content 2</div>
  </div>
</div>
```

### Badge Component
```html
<!-- Basic badges -->
<div class="badge">default</div>
<div class="badge badge-primary">primary</div>
<div class="badge badge-secondary">secondary</div>
<div class="badge badge-accent">accent</div>

<!-- Badge variants -->
<div class="badge badge-outline">outline</div>
<div class="badge badge-ghost">ghost</div>
<div class="badge badge-soft">soft</div>

<!-- Badge sizes -->
<div class="badge badge-xs">xs</div>
<div class="badge badge-sm">sm</div>
<div class="badge badge-md">md</div>
<div class="badge badge-lg">lg</div>
<div class="badge badge-xl">xl</div>

<!-- Status badges -->
<div class="badge badge-info">info</div>
<div class="badge badge-success">success</div>
<div class="badge badge-warning">warning</div>
<div class="badge badge-error">error</div>
```

### Form Components

#### Input
```html
<input type="text" placeholder="Type here" class="input input-bordered w-full max-w-xs" />

<!-- Input variants -->
<input type="text" class="input input-ghost" placeholder="Ghost input" />
<input type="text" class="input input-bordered input-primary" placeholder="Primary" />
<input type="text" class="input input-bordered input-secondary" placeholder="Secondary" />

<!-- Input sizes -->
<input type="text" class="input input-bordered input-xs" placeholder="Extra small" />
<input type="text" class="input input-bordered input-sm" placeholder="Small" />
<input type="text" class="input input-bordered input-md" placeholder="Medium" />
<input type="text" class="input input-bordered input-lg" placeholder="Large" />
```

#### Textarea
```html
<textarea class="textarea textarea-bordered" placeholder="Bio"></textarea>
<textarea class="textarea textarea-bordered textarea-primary" placeholder="Primary textarea"></textarea>
```

#### Select
```html
<select class="select select-bordered w-full max-w-xs">
  <option disabled selected>Pick one</option>
  <option>Option 1</option>
  <option>Option 2</option>
</select>
```

#### Checkbox
```html
<input type="checkbox" checked="checked" class="checkbox" />
<input type="checkbox" checked="checked" class="checkbox checkbox-primary" />
<input type="checkbox" checked="checked" class="checkbox checkbox-secondary" />

<!-- Custom colors -->
<input type="checkbox" checked="checked" class="checkbox border-indigo-600 bg-indigo-500 checked:border-orange-500 checked:bg-orange-400" />
```

#### Radio
```html
<input type="radio" name="radio-1" class="radio" checked />
<input type="radio" name="radio-1" class="radio radio-primary" />
<input type="radio" name="radio-1" class="radio radio-secondary" />
```

#### Toggle
```html
<input type="checkbox" class="toggle" checked />
<input type="checkbox" class="toggle toggle-primary" checked />
<input type="checkbox" class="toggle toggle-secondary" checked />

<!-- Toggle sizes -->
<input type="checkbox" class="toggle toggle-xs" />
<input type="checkbox" class="toggle toggle-sm" />
<input type="checkbox" class="toggle toggle-md" />
<input type="checkbox" class="toggle toggle-lg" />
```

#### Range
```html
<input type="range" min="0" max="100" value="40" class="range" />
<input type="range" min="0" max="100" value="25" class="range range-primary" />
<input type="range" min="0" max="100" value="50" class="range range-secondary" />
```

#### Rating
```html
<div class="rating">
  <input type="radio" name="rating-1" class="rating-hidden" />
  <input type="radio" name="rating-1" class="mask mask-star-2" />
  <input type="radio" name="rating-1" class="mask mask-star-2" checked />
  <input type="radio" name="rating-1" class="mask mask-star-2" />
  <input type="radio" name="rating-1" class="mask mask-star-2" />
  <input type="radio" name="rating-1" class="mask mask-star-2" />
</div>

<!-- Colored rating -->
<div class="rating">
  <input type="radio" name="rating-2" class="mask mask-star-2 bg-orange-400" />
  <input type="radio" name="rating-2" class="mask mask-star-2 bg-orange-400" checked />
  <input type="radio" name="rating-2" class="mask mask-star-2 bg-orange-400" />
</div>
```

### Join Component
```html
<!-- Basic join -->
<div class="join">
  <button class="btn join-item">Button</button>
  <button class="btn join-item">Button</button>
  <button class="btn join-item">Button</button>
</div>

<!-- Join with input and button -->
<div class="join">
  <input class="input input-bordered join-item" placeholder="Email"/>
  <button class="btn join-item btn-primary">Subscribe</button>
</div>

<!-- Join with radio buttons -->
<div class="join">
  <input class="join-item btn" type="radio" name="options" aria-label="1" checked />
  <input class="join-item btn" type="radio" name="options" aria-label="2" />
  <input class="join-item btn" type="radio" name="options" aria-label="3" />
</div>

<!-- Complex join with search -->
<div class="join">
  <input class="input join-item" placeholder="Search" />
  <select class="select join-item">
    <option disabled selected>Filter</option>
    <option>Sci-fi</option>
    <option>Drama</option>
    <option>Action</option>
  </select>
  <button class="btn join-item">Search</button>
</div>
```

### Loading Component
```html
<span class="loading loading-spinner loading-xs"></span>
<span class="loading loading-spinner loading-sm"></span>
<span class="loading loading-spinner loading-md"></span>
<span class="loading loading-spinner loading-lg"></span>

<!-- Different loading styles -->
<span class="loading loading-dots loading-lg"></span>
<span class="loading loading-ring loading-lg"></span>
<span class="loading loading-ball loading-lg"></span>
<span class="loading loading-bars loading-lg"></span>
<span class="loading loading-infinity loading-lg"></span>
```

### Chat Component
```html
<!-- Basic chat -->
<div class="chat chat-start">
  <div class="chat-bubble">Hello! How are you?</div>
</div>
<div class="chat chat-end">
  <div class="chat-bubble">I'm doing great, thanks!</div>
</div>

<!-- Chat with avatar -->
<div class="chat chat-start">
  <div class="chat-image avatar">
    <div class="w-10 rounded-full">
      <img src="avatar1.jpg" alt="User avatar" />
    </div>
  </div>
  <div class="chat-bubble">Hello there</div>
</div>

<!-- Chat with header and footer -->
<div class="chat chat-start">
  <div class="chat-image avatar">
    <div class="w-10 rounded-full">
      <img src="avatar1.jpg" alt="User avatar" />
    </div>
  </div>
  <div class="chat-header">
    John Doe
    <time class="text-xs opacity-50">12:45</time>
  </div>
  <div class="chat-bubble">How are you today?</div>
  <div class="chat-footer opacity-50">Delivered</div>
</div>
```

### Theme Controller
```html
<!-- Theme toggle -->
<input type="checkbox" value="synthwave" class="toggle theme-controller" />

<!-- Theme dropdown -->
<div class="dropdown">
  <div tabindex="0" role="button" class="btn m-1">
    Theme
    <svg width="12px" height="12px" class="inline-block h-2 w-2 fill-current opacity-60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048">
      <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z"></path>
    </svg>
  </div>
  <ul tabindex="0" class="dropdown-content bg-base-300 rounded-box z-1 w-52 p-2 shadow-2xl">
    <li>
      <input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Default" value="default" />
    </li>
    <li>
      <input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Retro" value="retro" />
    </li>
    <li>
      <input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Cyberpunk" value="cyberpunk" />
    </li>
  </ul>
</div>
```

## Vue Integration Patterns

### Composable for Theme Management
```vue
<!-- composables/useTheme.js -->
<script>
import { ref, onMounted } from 'vue'

export function useTheme() {
  const current_theme = ref('light')

  const setTheme = (theme) => {
    current_theme.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }

  const toggleTheme = () => {
    const new_theme = current_theme.value === 'light' ? 'dark' : 'light'
    setTheme(new_theme)
  }

  onMounted(() => {
    const saved_theme = localStorage.getItem('theme') || 'light'
    setTheme(saved_theme)
  })

  return {
    current_theme,
    setTheme,
    toggleTheme
  }
}
</script>
```

### Vue Modal Component
```vue
<template>
  <dialog ref="modal_ref" class="modal">
    <div class="modal-box">
      <h3 class="font-bold text-lg">{{ title }}</h3>
      <div class="py-4">
        <slot></slot>
      </div>
      <div class="modal-action" :class="action_classes">
        <button v-if="show_cancel" class="btn" @click="cancel">
          {{ cancel_text }}
        </button>
        <button v-if="show_save" class="btn btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="loading loading-spinner loading-sm"></span>
          {{ save_text }}
        </button>
        <button v-if="show_delete" class="btn btn-error mr-auto" @click="delete_item">
          {{ delete_text }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  title: String,
  show_cancel: { type: Boolean, default: true },
  show_save: { type: Boolean, default: true },
  show_delete: { type: Boolean, default: false },
  cancel_text: { type: String, default: 'Cancel' },
  save_text: { type: String, default: 'Save' },
  delete_text: { type: String, default: 'Delete' },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['save', 'cancel', 'delete'])
const modal_ref = ref(null)

// Modal button layout pattern for proper visual/DOM order
const action_classes = computed(() => 'flex-row-reverse')

const open = () => modal_ref.value?.showModal()
const close = () => modal_ref.value?.close()

const save = () => {
  emit('save')
}

const cancel = () => {
  close()
  emit('cancel')
}

const delete_item = () => {
  emit('delete')
}

defineExpose({ open, close })
</script>
```

### Vue Form Components
```vue
<template>
  <!-- Form Input Wrapper -->
  <div class="form-control w-full max-w-xs">
    <label class="label">
      <span class="label-text">{{ label }}</span>
    </label>
    <input
      :type="type"
      :placeholder="placeholder"
      :value="model_value"
      @input="$emit('update:model_value', $event.target.value)"
      class="input input-bordered"
      :class="input_classes"
    />
    <label v-if="error" class="label">
      <span class="label-text-alt text-error">{{ error }}</span>
    </label>
  </div>
</template>

<script setup>
const props = defineProps({
  label: String,
  type: { type: String, default: 'text' },
  placeholder: String,
  model_value: String,
  error: String,
  variant: String
})

const emit = defineEmits(['update:model_value'])

const input_classes = computed(() => {
  const classes = []
  if (props.variant) classes.push(`input-${props.variant}`)
  if (props.error) classes.push('input-error')
  return classes.join(' ')
})
</script>
```

## Theming

### Built-in Themes
daisyUI v5 comes with built-in themes:
- `light` (default)
- `dark`
- `cupcake`
- `bumblebee`
- `emerald`
- `corporate`
- `synthwave`
- `retro`
- `cyberpunk`
- `valentine`
- `halloween`
- `garden`
- `forest`
- `aqua`
- `lofi`
- `pastel`
- `fantasy`
- `wireframe`
- `black`
- `luxury`
- `dracula`
- `cmyk`
- `autumn`
- `business`
- `acid`
- `lemonade`
- `night`
- `coffee`
- `winter`

### Theme Configuration
```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: winter --default, night --prefersdark;
}
```

### Custom Theme Creation
```css
@import "tailwindcss";
@plugin "daisyui";
@plugin "daisyui/theme" {
  name: "mytheme";
  default: true;
  prefersdark: false;
  color-scheme: light;

  --color-base-100: oklch(98% 0.02 240);
  --color-base-200: oklch(95% 0.03 240);
  --color-base-300: oklch(92% 0.04 240);
  --color-base-content: oklch(20% 0.05 240);
  --color-primary: oklch(55% 0.3 240);
  --color-primary-content: oklch(98% 0.01 240);
  --color-secondary: oklch(70% 0.25 200);
  --color-secondary-content: oklch(98% 0.01 200);
  --color-accent: oklch(65% 0.25 160);
  --color-accent-content: oklch(98% 0.01 160);
  --color-neutral: oklch(50% 0.05 240);
  --color-neutral-content: oklch(98% 0.01 240);
  --color-info: oklch(70% 0.2 220);
  --color-info-content: oklch(98% 0.01 220);
  --color-success: oklch(65% 0.25 140);
  --color-success-content: oklch(98% 0.01 140);
  --color-warning: oklch(80% 0.25 80);
  --color-warning-content: oklch(20% 0.05 80);
  --color-error: oklch(65% 0.3 30);
  --color-error-content: oklch(98% 0.01 30);

  --radius-selector: 1rem;
  --radius-field: 0.25rem;
  --radius-box: 0.5rem;

  --size-selector: 0.25rem;
  --size-field: 0.25rem;

  --border: 1px;
  --depth: 1;
  --noise: 0;
}
```

### CSS Variables Reference

#### Colors
- `--color-primary`, `--color-primary-content`
- `--color-secondary`, `--color-secondary-content`
- `--color-accent`, `--color-accent-content`
- `--color-neutral`, `--color-neutral-content`
- `--color-base-100`, `--color-base-200`, `--color-base-300`, `--color-base-content`
- `--color-info`, `--color-info-content`
- `--color-success`, `--color-success-content`
- `--color-warning`, `--color-warning-content`
- `--color-error`, `--color-error-content`

#### Design Tokens
- `--radius-selector` - Border radius for selectors (checkbox, toggle, badge)
- `--radius-field` - Border radius for fields (button, input, select, tab)
- `--radius-box` - Border radius for boxes (card, modal, alert)
- `--size-selector` - Base scale size for selectors
- `--size-field` - Base scale size for fields
- `--border` - Border width of all components
- `--depth` - Adds depth effect (0 or 1)
- `--noise` - Adds background noise effect (0 or 1)

## Customization Patterns

### Combining with Tailwind Utilities
```html
<!-- daisyUI component + Tailwind utilities -->
<button class="btn btn-primary rounded-full px-8">Custom Button</button>
<div class="card bg-gradient-to-r from-purple-500 to-pink-500">Gradient Card</div>
```

### Overriding Component Styles
```html
<!-- Using Tailwind utilities to override -->
<button class="btn border-indigo-600 bg-indigo-500 checked:border-orange-500">
  Custom Colors
</button>
```

### Global Component Customization
```css
@import "tailwindcss";
@plugin "daisyui";

@utility btn {
  @apply rounded-full;
}
```

### CSS Variable Override
```html
<!-- Inline CSS variable override -->
<div class="alert [--alert-color:blue]">
  Custom alert color
</div>
```

## Best Practices

1. **Use Semantic Colors**: Prefer daisyUI color names (`primary`, `secondary`) over Tailwind color names (`blue-500`, `red-400`) for theme consistency

2. **Component-First Approach**: Start with daisyUI components, then add Tailwind utilities for customization

3. **Avoid Specificity Issues**: Use `!` suffix sparingly when Tailwind utilities don't override daisyUI styles

4. **Theme Consistency**: Use `-content` colors to ensure proper contrast ratios

5. **Mobile-First**: daisyUI components are mobile-first by default, extend for larger screens

6. **Modal Button Layout**: Use `flex-row-reverse` class for proper visual order (Primary + Cancel → Destructive with `mr-auto`)

7. **Form Validation**: Use semantic color classes (`input-error`, `text-error`) for consistent validation styling

## Dynamic Classes Warning

❌ **Incorrect** - Dynamic class generation:
```html
<div class="btn btn-{{ type }}"></div>
<div class="bg-{{ color }}-500"></div>
```

✅ **Correct** - Full class strings:
```javascript
let button_class = 'btn btn-primary'
let color_class = 'bg-red-500'
```

## Common Layout Patterns

### Alert Component
```html
<div class="alert">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info shrink-0 w-6 h-6">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
  </svg>
  <span>Info alert message</span>
</div>

<div class="alert alert-success">
  <span>Success alert message</span>
</div>

<div class="alert alert-warning">
  <span>Warning alert message</span>
</div>

<div class="alert alert-error">
  <span>Error alert message</span>
</div>
```

### Breadcrumbs Component
```html
<div class="breadcrumbs text-sm">
  <ul>
    <li><a>Home</a></li>
    <li><a>Documents</a></li>
    <li>Add Document</li>
  </ul>
</div>
```

### Hero Component
```html
<div class="hero min-h-screen bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">Hello there</h1>
      <p class="py-6">Provident cupiditate voluptatem et in.</p>
      <button class="btn btn-primary">Get Started</button>
    </div>
  </div>
</div>
```

### Steps Component
```html
<ul class="steps steps-vertical lg:steps-horizontal">
  <li class="step step-primary">Register</li>
  <li class="step step-primary">Choose plan</li>
  <li class="step">Purchase</li>
  <li class="step">Receive Product</li>
</ul>
```

### Table Component
```html
<div class="overflow-x-auto">
  <table class="table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Job</th>
        <th>Company</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="flex items-center gap-3">
            <div class="avatar">
              <div class="mask mask-squircle w-12 h-12">
                <img src="avatar.jpg" alt="Avatar" />
              </div>
            </div>
            <div>
              <div class="font-bold">Hart Hagerty</div>
              <div class="text-sm opacity-50">United States</div>
            </div>
          </div>
        </td>
        <td>
          Zemlak, Daniel and Leannon
          <br/>
          <span class="badge badge-ghost badge-sm">Desktop Support Technician</span>
        </td>
        <td>Purple</td>
        <th>
          <button class="btn btn-ghost btn-xs">details</button>
        </th>
      </tr>
    </tbody>
  </table>
</div>
```

### Progress Component
```html
<progress class="progress w-56" value="32" max="100">32%</progress>
<progress class="progress progress-primary w-56" value="70" max="100">70%</progress>
<progress class="progress progress-success w-56" value="100" max="100">100%</progress>

<!-- Radial progress -->
<div class="radial-progress" style="--value:70;" role="progressbar">70%</div>
<div class="radial-progress text-primary" style="--value:70;" role="progressbar">70%</div>
```

### Tooltip Component
```html
<div class="tooltip" data-tip="hello">
  <button class="btn">Hover me</button>
</div>

<div class="tooltip tooltip-open" data-tip="hello">
  <button class="btn">Force open</button>
</div>

<div class="tooltip tooltip-top" data-tip="hello">
  <button class="btn">Top</button>
</div>

<div class="tooltip tooltip-bottom" data-tip="hello">
  <button class="btn">Bottom</button>
</div>

<div class="tooltip tooltip-left" data-tip="hello">
  <button class="btn">Left</button>
</div>

<div class="tooltip tooltip-right" data-tip="hello">
  <button class="btn">Right</button>
</div>
```

### File Input Component
```html
<input type="file" class="file-input w-full max-w-xs" />
<input type="file" class="file-input file-input-bordered w-full max-w-xs" />
<input type="file" class="file-input file-input-ghost w-full max-w-xs" />
```

### Divider Component
```html
<div class="divider">OR</div>
<div class="divider divider-horizontal">OR</div>
<div class="divider divider-start">Start</div>
<div class="divider divider-end">End</div>
```

### Stack Component
```html
<div class="stack">
  <div class="card shadow-md bg-primary text-primary-content">
    <div class="card-body">
      <h2 class="card-title">Notification 1</h2>
    </div>
  </div>
  <div class="card shadow bg-primary text-primary-content">
    <div class="card-body">
      <h2 class="card-title">Notification 2</h2>
    </div>
  </div>
  <div class="card bg-primary text-primary-content">
    <div class="card-body">
      <h2 class="card-title">Notification 3</h2>
    </div>
  </div>
</div>
```

## Resources
- **Official Documentation**: https://daisyui.com/
- **GitHub Repository**: https://github.com/saadeghi/daisyui
- **Tailwind CSS 4**: Required for daisyUI v5
- **Community**: Discord, GitHub Discussions
- **llms.txt**: https://daisyui.com/llms.txt (for AI code generation)

## Version Notes
- daisyUI v5 requires Tailwind CSS 4 alpha or higher
- Focus on performance and selective imports
- Enhanced theming capabilities
- Better accessibility features
- No JavaScript configuration file needed
- Pure CSS plugin architecture
