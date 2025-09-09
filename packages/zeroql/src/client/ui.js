/**
 * ZeroQL Declarative UI Framework
 *
 * Renders adaptive UI components from JSON descriptions.
 * Handles all ZeroQL operations declaratively with automatic state management.
 */

// Component Registry - Maps component types to render functions
const componentRegistry = new Map();

// Global state management
class StateManager {
  constructor() {
    this.state = {};
    this.listeners = new Map();
    this.componentStates = new Map();
  }

  get(path) {
    const keys = path.split('.');
    let value = this.state;
    for (const key of keys) {
      value = value?.[key];
    }
    return value;
  }

  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.state;

    for (const key of keys) {
      if (!target[key]) target[key] = {};
      target = target[key];
    }

    target[lastKey] = value;
    this.notify(path, value);
  }

  subscribe(path, callback) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path).add(callback);
    return () => this.listeners.get(path)?.delete(callback);
  }

  notify(path, value) {
    // Notify exact path listeners
    this.listeners.get(path)?.forEach(cb => cb(value));

    // Notify parent path listeners
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join('.');
      this.listeners.get(parentPath)?.forEach(cb => cb(this.get(parentPath)));
    }
  }

  // Component-specific state
  getComponentState(componentId) {
    if (!this.componentStates.has(componentId)) {
      this.componentStates.set(componentId, {});
    }
    return this.componentStates.get(componentId);
  }

  setComponentState(componentId, state) {
    this.componentStates.set(componentId, state);
    this.notify(`component.${componentId}`, state);
  }
}

const state = new StateManager();

/**
 * Base Component Class
 */
class Component {
  constructor(config, ws) {
    this.config = config;
    this.ws = ws;
    this.id = config.id || `comp_${Math.random().toString(36).substr(2, 9)}`;
    this.element = null;
    this.children = [];
    this.subscriptions = [];
  }

  // Evaluate value - handles static values, state bindings, and expressions
  evaluate(value) {
    if (typeof value !== 'string') return value;

    // State binding: ${state.path}
    if (value.startsWith('${') && value.endsWith('}')) {
      const path = value.slice(2, -1).trim();
      if (path.startsWith('state.')) {
        return state.get(path.substring(6));
      }
      if (path.startsWith('component.')) {
        const componentState = state.getComponentState(this.id);
        const componentPath = path.substring(10);
        return componentPath.split('.').reduce((obj, key) => obj?.[key], componentState);
      }
      // Evaluate as expression
      try {
        return new Function('state', 'component', `return ${path}`)(
          state.state,
          state.getComponentState(this.id)
        );
      } catch (e) {
        console.warn(`Failed to evaluate expression: ${path}`, e);
        return value;
      }
    }

    return value;
  }

  // Bind to state changes
  bind(path, callback) {
    const unsubscribe = state.subscribe(path, callback);
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // Process event handlers
  handleEvent(eventConfig) {
    return async (event) => {
      event.preventDefault?.();

      for (const action of (eventConfig.actions || [])) {
        await this.executeAction(action, event);
      }
    };
  }

  // Execute an action
  async executeAction(action, event) {
    switch (action.type) {
      case 'setState':
        state.set(action.path, this.evaluate(action.value));
        break;

      case 'setComponentState':
        const currentState = state.getComponentState(this.id);
        const newState = { ...currentState, [action.key]: this.evaluate(action.value) };
        state.setComponentState(this.id, newState);
        break;

      case 'call':
        await this.callZeroQL(action);
        break;

      case 'emit':
        this.emit(action.event, this.evaluate(action.data));
        break;

      case 'navigate':
        window.location.href = this.evaluate(action.url);
        break;

      case 'alert':
        alert(this.evaluate(action.message));
        break;

      case 'console':
        console[action.level || 'log'](this.evaluate(action.message));
        break;

      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }

  // Call ZeroQL API
  async callZeroQL(action) {
    try {
      const { operation, entity, params, onSuccess, onError, resultPath } = action;

      // Evaluate params
      const evaluatedParams = {};
      for (const [key, value] of Object.entries(params || {})) {
        evaluatedParams[key] = this.evaluate(value);
      }

      // Make the call
      let result;
      if (operation && entity) {
        // ZeroQL operation: ws.api.{operation}.{entity}(params)
        result = await this.ws.api[operation][entity](evaluatedParams);
      } else if (action.method) {
        // Direct method call: ws.call(method, params)
        result = await this.ws.call(action.method, evaluatedParams);
      }

      // Store result if path provided
      if (resultPath) {
        state.set(resultPath, result);
      }

      // Execute success actions
      if (onSuccess) {
        for (const successAction of onSuccess) {
          await this.executeAction(successAction);
        }
      }
    } catch (error) {
      console.error('ZeroQL call failed:', error);

      // Store error if path provided
      if (action.errorPath) {
        state.set(action.errorPath, error.message);
      }

      // Execute error actions
      if (action.onError) {
        for (const errorAction of action.onError) {
          await this.executeAction(errorAction);
        }
      }
    }
  }

  // Emit custom event
  emit(eventName, data) {
    const event = new CustomEvent(eventName, { detail: data, bubbles: true });
    this.element?.dispatchEvent(event);
  }

  // Cleanup
  destroy() {
    this.subscriptions.forEach(unsub => unsub());
    this.children.forEach(child => child.destroy());
    this.element?.remove();
  }

  // Base render method (override in subclasses)
  render() {
    throw new Error('Component must implement render()');
  }
}

/**
 * Container Component - Renders child components
 */
class ContainerComponent extends Component {
  render() {
    const el = document.createElement(this.config.tag || 'div');
    this.element = el;

    // Apply attributes
    if (this.config.attributes) {
      for (const [key, value] of Object.entries(this.config.attributes)) {
        el.setAttribute(key, this.evaluate(value));
      }
    }

    // Apply styles
    if (this.config.style) {
      Object.assign(el.style, this.config.style);
    }

    // Apply classes
    if (this.config.class) {
      el.className = this.evaluate(this.config.class);
    }

    // Render children
    if (this.config.children) {
      for (const childConfig of this.config.children) {
        const child = renderComponent(childConfig, this.ws);
        if (child) {
          this.children.push(child);
          el.appendChild(child.element);
        }
      }
    }

    // Bind to visibility
    if (this.config.visible) {
      const updateVisibility = () => {
        el.style.display = this.evaluate(this.config.visible) ? '' : 'none';
      };
      updateVisibility();

      if (this.config.visible.includes('${')) {
        const path = this.config.visible.slice(2, -1).split('.').slice(1).join('.');
        this.bind(path, updateVisibility);
      }
    }

    return el;
  }
}

/**
 * Text Component - Renders text content
 */
class TextComponent extends Component {
  render() {
    const el = document.createElement(this.config.tag || 'span');
    this.element = el;

    const updateText = () => {
      el.textContent = this.evaluate(this.config.text || this.config.content || '');
    };
    updateText();

    // Bind to state changes if needed
    const content = this.config.text || this.config.content || '';
    if (typeof content === 'string' && content.includes('${')) {
      const match = content.match(/\${state\.([^}]+)}/);
      if (match) {
        this.bind(match[1], updateText);
      }
    }

    // Apply attributes
    if (this.config.attributes) {
      for (const [key, value] of Object.entries(this.config.attributes)) {
        el.setAttribute(key, this.evaluate(value));
      }
    }

    // Apply styles
    if (this.config.style) {
      Object.assign(el.style, this.config.style);
    }

    return el;
  }
}

/**
 * Input Component - Form input with two-way binding
 */
class InputComponent extends Component {
  render() {
    const el = document.createElement('input');
    this.element = el;

    // Set type
    el.type = this.config.inputType || 'text';

    // Set initial value and bind
    if (this.config.bind) {
      const path = this.config.bind.replace('${state.', '').replace('}', '');
      el.value = state.get(path) || '';

      // Two-way binding
      el.addEventListener('input', () => {
        state.set(path, el.value);
      });

      this.bind(path, (value) => {
        if (el.value !== value) {
          el.value = value || '';
        }
      });
    }

    // Apply attributes
    if (this.config.attributes) {
      for (const [key, value] of Object.entries(this.config.attributes)) {
        el.setAttribute(key, this.evaluate(value));
      }
    }

    // Handle events
    if (this.config.events) {
      for (const [eventName, eventConfig] of Object.entries(this.config.events)) {
        el.addEventListener(eventName, this.handleEvent(eventConfig));
      }
    }

    return el;
  }
}

/**
 * Button Component
 */
class ButtonComponent extends Component {
  render() {
    const el = document.createElement('button');
    this.element = el;

    // Set text
    const updateText = () => {
      el.textContent = this.evaluate(this.config.text || 'Button');
    };
    updateText();

    // Bind text to state if needed
    if (this.config.text?.includes('${')) {
      const match = this.config.text.match(/\${state\.([^}]+)}/);
      if (match) {
        this.bind(match[1], updateText);
      }
    }

    // Handle click event
    if (this.config.onClick) {
      el.addEventListener('click', this.handleEvent(this.config.onClick));
    }

    // Apply attributes
    if (this.config.attributes) {
      for (const [key, value] of Object.entries(this.config.attributes)) {
        el.setAttribute(key, this.evaluate(value));
      }
    }

    // Apply styles
    if (this.config.style) {
      Object.assign(el.style, this.config.style);
    }

    // Handle disabled state
    if (this.config.disabled !== undefined) {
      const updateDisabled = () => {
        el.disabled = this.evaluate(this.config.disabled);
      };
      updateDisabled();

      if (typeof this.config.disabled === 'string' && this.config.disabled.includes('${')) {
        const match = this.config.disabled.match(/\${state\.([^}]+)}/);
        if (match) {
          this.bind(match[1], updateDisabled);
        }
      }
    }

    return el;
  }
}

/**
 * Table Component - Renders data tables with ZeroQL integration
 */
class TableComponent extends Component {
  render() {
    const container = document.createElement('div');
    this.element = container;
    container.className = 'table-container';

    const renderTable = (data) => {
      container.innerHTML = '';

      if (!data || !Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<p>No data available</p>';
        return;
      }

      const table = document.createElement('table');
      table.className = this.config.class || '';

      // Header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const columns = this.config.columns || Object.keys(data[0]);

      columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = typeof col === 'object' ? col.label : col;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');
      data.forEach(row => {
        const tr = document.createElement('tr');
        columns.forEach(col => {
          const td = document.createElement('td');
          const field = typeof col === 'object' ? col.field : col;
          const value = row[field];

          // Handle nested values
          if (field.includes('.')) {
            const parts = field.split('.');
            let nestedValue = row;
            for (const part of parts) {
              nestedValue = nestedValue?.[part];
            }
            td.textContent = nestedValue ?? '';
          } else {
            td.textContent = value ?? '';
          }

          tr.appendChild(td);
        });

        // Row click handler
        if (this.config.onRowClick) {
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => {
            this.executeAction({
              ...this.config.onRowClick,
              value: row
            });
          });
        }

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      container.appendChild(table);
    };

    // Initial render
    if (this.config.data) {
      const data = this.evaluate(this.config.data);
      renderTable(data);
    }

    // Auto-fetch if configured
    if (this.config.fetch) {
      this.callZeroQL({
        ...this.config.fetch,
        onSuccess: [{
          type: 'setState',
          path: this.config.dataPath || `tables.${this.id}`,
          value: '${result}'
        }]
      });
    }

    // Bind to data changes
    if (this.config.dataPath || this.config.data?.includes('${')) {
      const path = this.config.dataPath || this.config.data.slice(9, -1); // Remove ${state. and }
      this.bind(path, renderTable);
    }

    return container;
  }
}

/**
 * Form Component - Handles form submission with validation
 */
class FormComponent extends Component {
  render() {
    const form = document.createElement('form');
    this.element = form;

    // Render fields
    if (this.config.fields) {
      this.config.fields.forEach(fieldConfig => {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'form-field';

        // Label
        if (fieldConfig.label) {
          const label = document.createElement('label');
          label.textContent = fieldConfig.label;
          if (fieldConfig.id) {
            label.setAttribute('for', fieldConfig.id);
          }
          fieldContainer.appendChild(label);
        }

        // Input
        const input = renderComponent({
          type: 'input',
          ...fieldConfig
        }, this.ws);

        this.children.push(input);
        fieldContainer.appendChild(input.element);

        form.appendChild(fieldContainer);
      });
    }

    // Submit button
    if (this.config.submitButton) {
      const submitBtn = renderComponent({
        type: 'button',
        text: 'Submit',
        ...this.config.submitButton
      }, this.ws);
      this.children.push(submitBtn);
      form.appendChild(submitBtn.element);
    }

    // Handle form submission
    if (this.config.onSubmit) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Collect form data
        const formData = {};
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
          if (input.name) {
            formData[input.name] = input.value;
          }
        });

        // Store form data in state
        if (this.config.dataPath) {
          state.set(this.config.dataPath, formData);
        }

        // Execute submit actions
        await this.handleEvent(this.config.onSubmit)(e);
      });
    }

    return form;
  }
}

/**
 * Select Component - Dropdown with ZeroQL lookup integration
 */
class SelectComponent extends Component {
  render() {
    const select = document.createElement('select');
    this.element = select;

    // Set name
    if (this.config.name) {
      select.name = this.config.name;
    }

    // Render options
    const renderOptions = (options) => {
      select.innerHTML = '';

      // Add placeholder
      if (this.config.placeholder) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = this.config.placeholder;
        option.disabled = true;
        option.selected = true;
        select.appendChild(option);
      }

      // Add options
      if (options && Array.isArray(options)) {
        options.forEach(opt => {
          const option = document.createElement('option');
          if (typeof opt === 'object') {
            option.value = opt.value;
            option.textContent = opt.label || opt.text;
          } else {
            option.value = opt;
            option.textContent = opt;
          }
          select.appendChild(option);
        });
      }
    };

    // Initial options
    if (this.config.options) {
      renderOptions(this.evaluate(this.config.options));
    }

    // Auto-fetch options via lookup
    if (this.config.lookup) {
      this.callZeroQL({
        operation: 'lookup',
        entity: this.config.lookup.entity,
        params: this.config.lookup.params || {},
        resultPath: `selects.${this.id}.options`
      }).then(() => {
        const options = state.get(`selects.${this.id}.options`);
        renderOptions(options);
      });
    }

    // Two-way binding
    if (this.config.bind) {
      const path = this.config.bind.replace('${state.', '').replace('}', '');
      select.value = state.get(path) || '';

      select.addEventListener('change', () => {
        state.set(path, select.value);
      });

      this.bind(path, (value) => {
        if (select.value !== value) {
          select.value = value || '';
        }
      });
    }

    // Handle change event
    if (this.config.onChange) {
      select.addEventListener('change', this.handleEvent(this.config.onChange));
    }

    return select;
  }
}

/**
 * List Component - Renders lists with templates
 */
class ListComponent extends Component {
  render() {
    const container = document.createElement(this.config.tag || 'ul');
    this.element = container;

    const renderList = (items) => {
      container.innerHTML = '';
      this.children.forEach(child => child.destroy());
      this.children = [];

      if (!items || !Array.isArray(items)) return;

      items.forEach((item, index) => {
        const itemElement = document.createElement(this.config.itemTag || 'li');

        // Render item template
        if (this.config.template) {
          // Create a temporary state context for the item
          const itemComponent = renderComponent({
            ...this.config.template,
            // Inject item data into template
            context: { item, index }
          }, this.ws);

          this.children.push(itemComponent);
          itemElement.appendChild(itemComponent.element);
        } else {
          // Simple text rendering
          itemElement.textContent = typeof item === 'object' ? JSON.stringify(item) : item;
        }

        container.appendChild(itemElement);
      });
    };

    // Initial render
    if (this.config.items) {
      renderList(this.evaluate(this.config.items));
    }

    // Auto-fetch if configured
    if (this.config.fetch) {
      this.callZeroQL({
        ...this.config.fetch,
        resultPath: `lists.${this.id}`
      }).then(() => {
        const items = state.get(`lists.${this.id}`);
        renderList(items);
      });
    }

    // Bind to data changes
    if (this.config.itemsPath || this.config.items?.includes('${')) {
      const path = this.config.itemsPath || this.config.items.slice(9, -1);
      this.bind(path, renderList);
    }

    return container;
  }
}

/**
 * Conditional Component - Renders based on condition
 */
class ConditionalComponent extends Component {
  render() {
    const container = document.createElement('div');
    this.element = container;
    container.style.display = 'contents'; // Invisible wrapper

    const updateContent = () => {
      // Clear previous content
      container.innerHTML = '';
      this.children.forEach(child => child.destroy());
      this.children = [];

      // Evaluate condition
      const condition = this.evaluate(this.config.condition);

      // Render appropriate branch
      const branch = condition ? this.config.then : this.config.else;
      if (branch) {
        const child = renderComponent(branch, this.ws);
        if (child) {
          this.children.push(child);
          container.appendChild(child.element);
        }
      }
    };

    updateContent();

    // Bind to condition changes
    if (typeof this.config.condition === 'string' && this.config.condition.includes('${')) {
      const match = this.config.condition.match(/\${state\.([^}]+)}/);
      if (match) {
        this.bind(match[1], updateContent);
      }
    }

    return container;
  }
}

// Register built-in components
componentRegistry.set('container', ContainerComponent);
componentRegistry.set('div', ContainerComponent);
componentRegistry.set('section', ContainerComponent);
componentRegistry.set('text', TextComponent);
componentRegistry.set('span', TextComponent);
componentRegistry.set('p', TextComponent);
componentRegistry.set('h1', TextComponent);
componentRegistry.set('h2', TextComponent);
componentRegistry.set('h3', TextComponent);
componentRegistry.set('input', InputComponent);
componentRegistry.set('button', ButtonComponent);
componentRegistry.set('table', TableComponent);
componentRegistry.set('form', FormComponent);
componentRegistry.set('select', SelectComponent);
componentRegistry.set('list', ListComponent);
componentRegistry.set('if', ConditionalComponent);

/**
 * Main render function
 */
function renderComponent(config, ws) {
  if (!config) return null;

  const ComponentClass = componentRegistry.get(config.type) || ContainerComponent;
  const component = new ComponentClass(config, ws);
  component.render();
  return component;
}

/**
 * Mount a UI configuration to a DOM element
 */
export function mount(config, element, ws) {
  // Clear existing content
  element.innerHTML = '';

  // Render root component
  const root = renderComponent(config, ws);
  if (root) {
    element.appendChild(root.element);
  }

  return {
    root,
    state,
    destroy: () => root?.destroy()
  };
}

/**
 * Register a custom component
 */
export function registerComponent(name, ComponentClass) {
  componentRegistry.set(name, ComponentClass);
}

/**
 * Export state manager for external access
 */
export { state, Component };

/**
 * Example UI configuration
 */
export const exampleUI = {
  type: 'container',
  class: 'app',
  children: [
    {
      type: 'h1',
      text: 'ZeroQL Declarative UI'
    },
    {
      type: 'section',
      class: 'search-section',
      children: [
        {
          type: 'h2',
          text: 'Search Venues'
        },
        {
          type: 'form',
          dataPath: 'searchForm',
          fields: [
            {
              name: 'search',
              label: 'Search',
              inputType: 'text',
              bind: '${state.searchQuery}',
              attributes: { placeholder: 'Enter search term...' }
            },
            {
              name: 'city',
              label: 'City',
              inputType: 'text',
              bind: '${state.searchCity}'
            }
          ],
          submitButton: {
            text: 'Search',
            onClick: {
              actions: [
                {
                  type: 'call',
                  operation: 'search',
                  entity: 'venues',
                  params: {
                    filters: {
                      _search: '${state.searchQuery}',
                      city: '${state.searchCity}'
                    },
                    limit: 10
                  },
                  resultPath: 'searchResults'
                }
              ]
            }
          }
        },
        {
          type: 'if',
          condition: '${state.searchResults}',
          then: {
            type: 'div',
            children: [
              {
                type: 'p',
                text: 'Found ${state.searchResults.total} results'
              },
              {
                type: 'table',
                data: '${state.searchResults.data}',
                columns: [
                  { field: 'id', label: 'ID' },
                  { field: 'name', label: 'Name' },
                  { field: 'city', label: 'City' },
                  { field: 'capacity', label: 'Capacity' }
                ],
                onRowClick: {
                  type: 'setState',
                  path: 'selectedVenue',
                  value: '${row}'
                }
              }
            ]
          }
        }
      ]
    },
    {
      type: 'if',
      condition: '${state.selectedVenue}',
      then: {
        type: 'section',
        class: 'detail-section',
        children: [
          {
            type: 'h2',
            text: 'Selected Venue: ${state.selectedVenue.name}'
          },
          {
            type: 'button',
            text: 'Edit',
            onClick: {
              actions: [
                {
                  type: 'setState',
                  path: 'editMode',
                  value: true
                }
              ]
            }
          }
        ]
      }
    }
  ]
};
