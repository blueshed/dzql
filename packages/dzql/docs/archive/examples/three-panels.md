# Three-Panel Responsive Layout: Context/Content/Properties

A responsive layout pattern using Tailwind CSS classes to show three panels on desktop and single-panel navigation on mobile. The three panels represent: **Context** (left), **Content** (center), and **Properties** (right).

## Visual Layout

### Desktop (≥768px)
```
┌────────────────────────────────────────────────────────────┐
│ Header with panel toggle buttons                          │
├──────────┬──────────────────────────┬─────────────────────┤
│ Context  │      Content             │    Properties       │
│  Panel   │      Panel               │      Panel          │
│  w-80    │      flex-1              │      w-96           │
│  toggle  │   always visible         │      toggle         │
└──────────┴──────────────────────────┴─────────────────────┘
```

### Mobile (<768px)
```
┌────────────────────────────────────────────────────────────┐
│ Breadcrumb: Context > Content > Properties                │
├────────────────────────────────────────────────────────────┤
│                                                            │
│            Active Panel (full screen)                      │
│            Context OR Content OR Properties                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Core Concept

This pattern uses **Tailwind CSS classes** to control visibility—no JavaScript layout manipulation.

**Desktop**: Users toggle panels on/off via buttons (localStorage persists preferences)  
**Mobile**: Users navigate between panels via breadcrumb (only one panel visible at a time)

**State management** is minimal:
- Boolean refs for desktop panel toggles (default: true)
- String ref for mobile active panel (default: 'context')
- Vue Router for data loading (not panel navigation)

## Implementation

### 1. State Setup

```vue
<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Desktop panel visibility
const show_context_panel = ref(true);
const show_properties_panel = ref(true);

// Mobile active panel
const mobile_view = ref('context'); // 'context' | 'content' | 'properties'

// Helper for auto-navigation
const is_mobile = () => window.innerWidth < 768;

const navigate_to_panel = (panel) => {
  mobile_view.value = panel;
};
</script>
```

### 2. Template Structure

```vue
<template>
  <div class="flex flex-col min-h-screen">
    
    <!-- Mobile Breadcrumb -->
    <Breadcrumb
      class="md:hidden"
      :active_view="mobile_view"
      @navigate="navigate_to_panel"
    />

    <!-- Desktop Header -->
    <div class="hidden md:block bg-white border-b px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <button @click="router.push('/list')">
            <ArrowLeftIcon class="w-5 h-5" />
          </button>
          <h1 class="text-2xl font-bold">{{ title }}</h1>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="show_context_panel = !show_context_panel"
            :class="[
              'p-2 rounded-md transition-colors',
              show_context_panel
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-400 hover:text-gray-600'
            ]"
            title="Toggle Context Panel"
          >
            <EllipsisVerticalIcon class="w-5 h-5" />
          </button>
          <button
            @click="show_properties_panel = !show_properties_panel"
            :class="[
              'p-2 rounded-md transition-colors',
              show_properties_panel
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-400 hover:text-gray-600'
            ]"
            title="Toggle Properties Panel"
          >
            <EllipsisHorizontalIcon class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Three Panel Layout -->
    <div class="flex-1 flex min-h-0">
      
      <!-- CONTEXT PANEL -->
      <div :class="[
        'w-full md:w-80 bg-gray-50 md:border-r flex flex-col',
        mobile_view === 'context' ? 'block' : 'hidden',
        show_context_panel ? 'md:block' : 'md:hidden'
      ]">
        <div class="p-4 border-b bg-white">
          <h2 class="font-semibold text-gray-900">Context</h2>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <!-- Context panel content (tree, list, navigation) -->
        </div>
      </div>

      <!-- CONTENT PANEL -->
      <div :class="[
        'flex-1 bg-white',
        mobile_view === 'content' ? 'block md:block' : 'hidden md:block'
      ]">
        <!-- Main content (map, canvas, editor, etc.) -->
      </div>

      <!-- PROPERTIES PANEL -->
      <div :class="[
        'w-full md:w-96 bg-white md:border-l flex flex-col',
        mobile_view === 'properties' ? 'block' : 'hidden',
        show_properties_panel ? 'md:block' : 'md:hidden'
      ]">
        <div class="p-4 border-b">
          <h2 class="font-semibold text-gray-900">Properties</h2>
        </div>
        <div class="flex-1 overflow-auto">
          <!-- Properties panel content (forms, details) -->
        </div>
      </div>

    </div>
  </div>
</template>
```

## The Tailwind CSS Pattern

Each panel uses a `:class` array with three parts:

```vue
:class="[
  'w-full md:w-80 bg-gray-50 md:border-r flex flex-col',  // 1. Base styles
  mobile_view === 'context' ? 'block' : 'hidden',         // 2. Mobile visibility
  show_context_panel ? 'md:block' : 'md:hidden'           // 3. Desktop visibility
]"
```

### Breakdown

**1. Base classes**: Styling that applies in all states
- `w-full` - Full width on mobile
- `md:w-80` - Fixed 320px width on desktop
- `bg-gray-50` - Background color
- `md:border-r` - Border on desktop only
- `flex flex-col` - Flex layout for panel structure

**2. Mobile visibility**: Conditional block/hidden
- Shows panel when `mobile_view` matches this panel
- All other panels hidden

**3. Desktop visibility**: Conditional with `md:` prefix
- Shows panel when toggle is true
- Hidden when toggle is false
- Only applies on desktop (`md:` breakpoint)

### Content Panel Exception

The content panel is always visible on desktop (no toggle):

```vue
:class="[
  'flex-1 bg-white',
  mobile_view === 'content' ? 'block md:block' : 'hidden md:block'
]"
```

Note: `md:block` appears in both branches—it's always shown on desktop.

## Breadcrumb Component

The breadcrumb provides mobile navigation between panels:

```vue
<!-- Breadcrumb.vue -->
<template>
  <div class="bg-white border-b px-4 py-2">
    <nav class="flex items-center text-sm">
      
      <button
        @click="$emit('navigate', 'context')"
        :class="[
          active_view === 'context'
            ? 'text-gray-900 font-medium'
            : 'text-gray-600 hover:text-gray-900'
        ]"
      >
        Context
      </button>
      
      <ChevronRightIcon class="w-4 h-4 text-gray-400 mx-1" />
      
      <button
        @click="$emit('navigate', 'content')"
        :class="[
          active_view === 'content'
            ? 'text-gray-900 font-medium'
            : 'text-gray-600 hover:text-gray-900'
        ]"
      >
        Content
      </button>
      
      <ChevronRightIcon class="w-4 h-4 text-gray-400 mx-1" />
      
      <button
        @click="$emit('navigate', 'properties')"
        :class="[
          active_view === 'properties'
            ? 'text-gray-900 font-medium'
            : 'text-gray-600 hover:text-gray-900'
        ]"
      >
        Properties
      </button>
      
    </nav>
  </div>
</template>

<script setup>
import { ChevronRightIcon } from '@heroicons/vue/24/outline';

defineProps({
  active_view: String // 'context' | 'content' | 'properties'
});

defineEmits(['navigate']);
</script>
```

### Dynamic Breadcrumb Labels

Make labels reflect current content:

```vue
<template>
  <div class="bg-white border-b px-4 py-2">
    <nav class="flex items-center text-sm">
      <button @click="$emit('navigate', 'context')">
        {{ context_label }}
      </button>
      <ChevronRightIcon class="w-4 h-4 text-gray-400 mx-1" />
      <button @click="$emit('navigate', 'content')">
        {{ content_label }}
      </button>
      <ChevronRightIcon class="w-4 h-4 text-gray-400 mx-1" />
      <button @click="$emit('navigate', 'properties')">
        {{ properties_label }}
      </button>
    </nav>
  </div>
</template>

<script setup>
defineProps({
  context_label: { type: String, default: 'Context' },
  content_label: { type: String, default: 'Content' },
  properties_label: { type: String, default: 'Properties' },
  active_view: String
});
</script>
```

Usage:

```vue
<Breadcrumb
  class="md:hidden"
  :context_label="'Areas'"
  :content_label="active_area?.name || 'Map'"
  :properties_label="active_site ? 'Site' : 'Properties'"
  :active_view="mobile_view"
  @navigate="navigate_to_panel"
/>
```

## Auto-Navigation on Mobile

Automatically switch panels when users take actions:

```javascript
const select_item_from_context = (item) => {
  active_item.value = item;
  
  // Navigate to content on mobile
  if (is_mobile()) {
    mobile_view.value = 'content';
  }
};

const select_detail_from_content = (detail) => {
  active_detail.value = detail;
  
  // Navigate to properties on mobile
  if (is_mobile()) {
    mobile_view.value = 'properties';
  }
};
```

## Vue Router Integration

### Approach: Route = Data, Not Panel State

The route determines **what data to load**, not which panel is visible.

```javascript
// Route params determine data context
const props = defineProps({
  id: String // From route: /venue/:id
});

// Load data based on route
const load_from_route = async () => {
  const id = parseInt(props.id || route.params.id);
  if (!id) return;
  
  try {
    await store.loadItem(id);
  } catch (error) {
    console.error('Failed to load:', error);
  }
};

// Watch for route changes
watch(() => route.params.id, () => {
  load_from_route();
});

// Load on mount
onMounted(() => {
  load_from_route();
});
```

### Key Points

1. **Route params** (e.g., `/venue/123`) → Load data
2. **mobile_view state** → UI only, not synced to route
3. **Panel switches** on mobile don't change URL
4. **Navigation away** (e.g., back button) changes route

This keeps URLs simple and stable—bookmarking `/venue/123` always works regardless of which panel was visible.

### Alternative: Route Includes Panel

For more complex apps, you could include panel in route:

```javascript
// Routes
{
  path: '/venue/:id/:panel?',
  component: VenueDetail,
  props: true
}

// Sync mobile_view with route
watch(() => route.params.panel, (panel) => {
  if (panel && ['context', 'content', 'properties'].includes(panel)) {
    mobile_view.value = panel;
  }
});

// Navigate updates route
const navigate_to_panel = (panel) => {
  if (is_mobile()) {
    router.replace({ params: { ...route.params, panel } });
  }
  mobile_view.value = panel;
};
```

This makes browser back button work between panels, but adds complexity. **Use only if needed.**

## Panel Width Guidelines

- **Context**: `w-80` (320px) - Navigation trees, lists
- **Content**: `flex-1` - Takes remaining space
- **Properties**: `w-96` (384px) - Forms, detail views

All panels are `w-full` on mobile.

## Toggle Button Patterns

### Icons
- **Context panel**: `EllipsisVerticalIcon` (⋮)
- **Properties panel**: `EllipsisHorizontalIcon` (⋯)

### Button States

```vue
<button
  @click="show_context_panel = !show_context_panel"
  :class="[
    'p-2 rounded-md transition-colors',
    show_context_panel
      ? 'bg-gray-100 text-gray-700'      // Active
      : 'text-gray-400 hover:text-gray-600' // Inactive
  ]"
  title="Toggle Context Panel"
>
  <EllipsisVerticalIcon class="w-5 h-5" />
</button>
```

## When to Use This Pattern

✅ **Good for**:
- Applications with contextual navigation + main content + details
- Map interfaces with location tree and property inspector
- Code editors with file tree and symbol inspector
- Admin dashboards with navigation and detail panels
- Any interface where users need multiple simultaneous views on desktop

❌ **Not good for**:
- Simple list-detail views (use 2-column)
- Marketing/content sites
- When panels aren't logically distinct
- Mobile-first apps where desktop is secondary

## Complete Minimal Example

```vue
<template>
  <div class="flex flex-col min-h-screen">
    
    <!-- Mobile Breadcrumb -->
    <div class="md:hidden bg-white border-b px-4 py-2">
      <nav class="flex items-center gap-2 text-sm">
        <button
          @click="mobile_view = 'context'"
          :class="mobile_view === 'context' ? 'font-bold' : ''"
        >
          Context
        </button>
        <span>›</span>
        <button
          @click="mobile_view = 'content'"
          :class="mobile_view === 'content' ? 'font-bold' : ''"
        >
          Content
        </button>
        <span>›</span>
        <button
          @click="mobile_view = 'properties'"
          :class="mobile_view === 'properties' ? 'font-bold' : ''"
        >
          Properties
        </button>
      </nav>
    </div>

    <!-- Desktop Header -->
    <div class="hidden md:flex items-center justify-between bg-white border-b px-6 py-4">
      <h1 class="text-2xl font-bold">Three Panels</h1>
      <div class="flex gap-2">
        <button
          @click="show_context = !show_context"
          :class="show_context ? 'bg-gray-100' : 'text-gray-400'"
          class="p-2 rounded-md"
        >
          ⋮
        </button>
        <button
          @click="show_properties = !show_properties"
          :class="show_properties ? 'bg-gray-100' : 'text-gray-400'"
          class="p-2 rounded-md"
        >
          ⋯
        </button>
      </div>
    </div>

    <!-- Panels -->
    <div class="flex-1 flex min-h-0">
      
      <!-- Context -->
      <div :class="[
        'w-full md:w-80 bg-gray-50 md:border-r flex flex-col',
        mobile_view === 'context' ? 'block' : 'hidden',
        show_context ? 'md:block' : 'md:hidden'
      ]">
        <div class="p-4">
          <h2 class="font-semibold mb-4">Context Panel</h2>
          <p class="text-sm text-gray-600">Navigation, trees, lists</p>
        </div>
      </div>

      <!-- Content -->
      <div :class="[
        'flex-1 bg-white',
        mobile_view === 'content' ? 'block md:block' : 'hidden md:block'
      ]">
        <div class="p-4">
          <h2 class="font-semibold mb-4">Content Panel</h2>
          <p class="text-sm text-gray-600">Main content area</p>
        </div>
      </div>

      <!-- Properties -->
      <div :class="[
        'w-full md:w-96 bg-gray-50 md:border-l flex flex-col',
        mobile_view === 'properties' ? 'block' : 'hidden',
        show_properties ? 'md:block' : 'md:hidden'
      ]">
        <div class="p-4">
          <h2 class="font-semibold mb-4">Properties Panel</h2>
          <p class="text-sm text-gray-600">Details, forms, inspector</p>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const show_context = ref(true);
const show_properties = ref(true);
const mobile_view = ref('context');
</script>
```

## Key Takeaways

1. **Tailwind CSS does the work** - No JavaScript layout manipulation
2. **Three-part class pattern** - Base + mobile condition + desktop condition
3. **Two visibility systems** - Mobile uses single state, desktop uses two toggles
4. **Breadcrumb = navigation** - Not just informational on mobile
5. **Content always visible on desktop** - No toggle button needed
6. **Route = data context** - Panel state resets on reload
7. **Auto-navigate on mobile** - Switch panels based on user actions