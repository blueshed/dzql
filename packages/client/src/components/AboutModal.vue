<template>
  <dialog ref="aboutModal" class="modal">
    <div class="modal-box max-w-4xl bg-base-100">
      <!-- Header with DZQL Branding -->
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-xl dzql-brand-gradient flex items-center justify-center">
            <span class="text-2xl font-bold text-white">D</span>
          </div>
          <div>
            <h1 class="text-3xl font-bold text-base-content">DZQL</h1>
            <p class="text-base-content/70">WebSocket RPC + Auto CRUD Framework</p>
          </div>
        </div>
        <div class="dzql-status-indicator connected ws-pulse">
          <span class="w-2 h-2 bg-current rounded-full"></span>
          Live Connection
        </div>
      </div>

      <!-- Main Content Grid -->
      <div class="grid md:grid-cols-2 gap-6 mb-6">
        <!-- What is ZeroQL -->
        <div class="card bg-base-200/50 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
              What is ZeroQL?
            </h2>
            <p class="text-sm text-base-content/80">
              ZeroQL is an extension to a base WebSocket RPC system that automatically provides
              5 standard database operations per entity with <strong>zero boilerplate</strong>.
            </p>
            <div class="mt-4">
              <div class="badge badge-outline badge-primary mr-2">WebSocket RPC</div>
              <div class="badge badge-outline badge-secondary mr-2">Auto CRUD</div>
              <div class="badge badge-outline badge-accent">Real-time</div>
            </div>
          </div>
        </div>

        <!-- Architecture Overview -->
        <div class="card bg-base-200/50 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-secondary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h1.5c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125h-1.5A1.125 1.125 0 0 1 2.25 8.625v-1.5ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25A1.125 1.125 0 0 1 3.75 18.375v-2.25Z" />
              </svg>
              System Architecture
            </h2>
            <div class="space-y-3 text-sm">
              <div class="api-endpoint api-method-get">
                <strong>Base RPC Layer:</strong> WebSocket + JSON-RPC 2.0
              </div>
              <div class="api-endpoint api-method-post">
                <strong>ZeroQL Extension:</strong> Auto CRUD Operations
              </div>
              <div class="api-endpoint api-method-put">
                <strong>Real-time Events:</strong> PostgreSQL NOTIFY/LISTEN
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Philosophy Section -->
      <div class="card bg-gradient-to-r from-accent/5 to-info/5 border border-accent/20 mb-6">
        <div class="card-body">
          <h2 class="card-title text-accent text-xl mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 3.678a18.52 18.52 0 0 1-7.5 0M6.75 15a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 0v-3.675A55.378 55.378 0 0 1 12 4.772a55.378 55.378 0 0 1 5.25 6.553v3.675m-10.5 0A55.378 55.378 0 0 0 4.772 12 55.378 55.378 0 0 0 1.5 15v-3.675A55.378 55.378 0 0 1 12 4.772a55.378 55.378 0 0 1 10.5 6.328V15a55.378 55.378 0 0 1-10.5 0Z" />
            </svg>
            "It Just Works" Philosophy
          </h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <h3 class="font-semibold text-base-content mb-2">One Component, Full CRUD</h3>
              <div class="dzql-code text-xs">
                &lt;<span class="text-primary">DynamicEntity</span> <span class="text-secondary">entity</span>=<span class="text-warning">"venues"</span> /&gt;
              </div>
              <p class="text-sm text-base-content/80 mt-2">
                Instantly get searchable tables, pagination, real-time updates, and mobile-responsive design.
              </p>
            </div>
            <div>
              <h3 class="font-semibold text-base-content mb-2">Progressive Enhancement</h3>
              <ul class="text-sm text-base-content/80 space-y-1">
                <li>✓ Start with zero configuration</li>
                <li>✓ Override only what's different</li>
                <li>✓ Focus on your domain logic</li>
                <li>✓ Domain-specific, not generic admin</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- The 5 Standard Operations -->
      <div class="card bg-gradient-to-r from-primary/5 to-secondary/5 border border-primary/20 mb-6">
        <div class="card-body">
          <h2 class="card-title text-primary text-xl mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
            The 5 Standard Operations
          </h2>
          <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div class="text-center p-3 rounded-lg bg-base-100 shadow-sm">
              <div class="w-12 h-12 mx-auto mb-2 rounded-full bg-success/10 flex items-center justify-center">
                <span class="text-success font-bold">GET</span>
              </div>
              <div class="text-sm font-medium">Retrieve</div>
              <div class="text-xs text-base-content/70">Single record + FK</div>
            </div>
            <div class="text-center p-3 rounded-lg bg-base-100 shadow-sm">
              <div class="w-12 h-12 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                <span class="text-primary font-bold">SAVE</span>
              </div>
              <div class="text-sm font-medium">Upsert</div>
              <div class="text-xs text-base-content/70">Smart insert/update</div>
            </div>
            <div class="text-center p-3 rounded-lg bg-base-100 shadow-sm">
              <div class="w-12 h-12 mx-auto mb-2 rounded-full bg-error/10 flex items-center justify-center">
                <span class="text-error font-bold">DEL</span>
              </div>
              <div class="text-sm font-medium">Delete</div>
              <div class="text-xs text-base-content/70">Remove record</div>
            </div>
            <div class="text-center p-3 rounded-lg bg-base-100 shadow-sm">
              <div class="w-12 h-12 mx-auto mb-2 rounded-full bg-secondary/10 flex items-center justify-center">
                <span class="text-secondary font-bold">LOOK</span>
              </div>
              <div class="text-sm font-medium">Lookup</div>
              <div class="text-xs text-base-content/70">Dropdown data</div>
            </div>
            <div class="text-center p-3 rounded-lg bg-base-100 shadow-sm">
              <div class="w-12 h-12 mx-auto mb-2 rounded-full bg-accent/10 flex items-center justify-center">
                <span class="text-accent font-bold">SRCH</span>
              </div>
              <div class="text-sm font-medium">Search</div>
              <div class="text-xs text-base-content/70">Paginated results</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Code Examples -->
      <div class="grid md:grid-cols-2 gap-6 mb-6">
        <div class="card bg-base-200/50 shadow-sm">
          <div class="card-body">
            <h3 class="card-title text-accent text-lg">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
              </svg>
              Zero Boilerplate
            </h3>
            <div class="dzql-code">
              <div class="text-xs text-success mb-2">// Register entity once, get 5 operations instantly</div>
              <div class="text-sm">
                <span class="text-primary">SELECT</span> <span class="text-accent">dzql.register_entity</span>(<br>
                &nbsp;&nbsp;<span class="text-secondary">p_table_name</span> := <span class="text-warning">'venues'</span>,<br>
                &nbsp;&nbsp;<span class="text-secondary">p_label_field</span> := <span class="text-warning">'name'</span><br>
                );
              </div>
            </div>
          </div>
        </div>

        <div class="card bg-base-200/50 shadow-sm">
          <div class="card-body">
            <h3 class="card-title text-info text-lg">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5 10.5 19.5L20.25 4.5" />
              </svg>
              Instant API
            </h3>
            <div class="dzql-code">
              <div class="text-xs text-success mb-2">// All operations immediately available</div>
              <div class="text-sm">
                <span class="text-primary">const</span> venue = <span class="text-primary">await</span> <span class="text-accent">ws.api.get.venues</span>({<br>
                &nbsp;&nbsp;id: <span class="text-warning">1</span><br>
                });
                <div class="text-xs text-info mt-1">// Clean, simple JavaScript</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Performance Metrics -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="metric-card">
          <div class="card-body text-center p-4">
            <div class="metric-value">5</div>
            <div class="metric-label">Auto Operations</div>
          </div>
        </div>
        <div class="metric-card">
          <div class="card-body text-center p-4">
            <div class="metric-value">0</div>
            <div class="metric-label">Boilerplate</div>
          </div>
        </div>
        <div class="metric-card">
          <div class="card-body text-center p-4">
            <div class="metric-value">∞</div>
            <div class="metric-label">Real-time</div>
          </div>
        </div>
        <div class="metric-card">
          <div class="card-body text-center p-4">
            <div class="metric-value">1</div>
            <div class="metric-label">Registration</div>
          </div>
        </div>
      </div>

      <!-- Tech Stack -->
      <div class="card bg-base-200/50 shadow-sm mb-6">
        <div class="card-body">
          <h2 class="card-title text-neutral mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571-3" />
            </svg>
            Technology Stack
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="text-center">
              <div class="w-8 h-8 mx-auto mb-2 rounded bg-yellow-500 text-white flex items-center justify-center text-sm font-bold">JS</div>
              <div class="text-sm">JavaScript</div>
            </div>
            <div class="text-center">
              <div class="w-8 h-8 mx-auto mb-2 rounded bg-green-500 text-white flex items-center justify-center text-sm font-bold">V</div>
              <div class="text-sm">Vue 3</div>
            </div>
            <div class="text-center">
              <div class="w-8 h-8 mx-auto mb-2 rounded bg-purple-500 text-white flex items-center justify-center text-sm font-bold">PG</div>
              <div class="text-sm">PostgreSQL</div>
            </div>
            <div class="text-center">
              <div class="w-8 h-8 mx-auto mb-2 rounded bg-orange-500 text-white flex items-center justify-center text-sm font-bold">B</div>
              <div class="text-sm">Bun Runtime</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-between items-center pt-4 border-t border-base-300">
        <div class="text-sm text-base-content/60">
          Built with ❤️ using ZeroQL Framework • It Just Works
        </div>
        <div class="flex gap-2">
          <a href="https://github.com/dzql" target="_blank" class="btn btn-sm btn-ghost">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" class="w-4 h-4">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <button class="btn btn-sm btn-primary" @click="closeModal">
            Got it!
          </button>
        </div>
      </div>
    </div>

    <!-- Modal backdrop -->
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>

<script setup>
import { ref } from 'vue'

const aboutModal = ref(null)

const openModal = () => {
  aboutModal.value?.showModal()
}

const closeModal = () => {
  aboutModal.value?.close()
}

defineExpose({
  openModal,
  closeModal
})
</script>

<style scoped>
/* Custom animations for the modal */
@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.modal-box {
  animation: modalSlideIn 0.3s ease-out;
}

/* Enhanced metric cards */
.metric-card:hover .metric-value {
  transform: scale(1.1);
  transition: transform 0.2s ease;
}

/* Code syntax highlighting enhancement */
.dzql-code {
  position: relative;
}

.dzql-code::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(to bottom, oklch(60% 0.15 260), oklch(70% 0.18 120));
  border-radius: 0 2px 2px 0;
}
</style>
