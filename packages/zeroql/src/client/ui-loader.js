/**
 * ZeroQL UI Configuration Loader
 *
 * Loads UI configurations from JSON files or API endpoints
 * and renders them using the declarative UI framework.
 */

import { mount, state, Component, registerComponent } from './ui.js';

/**
 * UI Configuration Cache
 */
const configCache = new Map();

/**
 * Load a UI configuration from a URL or object
 */
export async function loadUI(source, container, ws) {
    let config;

    if (typeof source === 'string') {
        // Load from URL
        config = await fetchConfig(source);
    } else if (typeof source === 'object') {
        // Direct configuration object
        config = source;
    } else {
        throw new Error('Invalid UI source: must be a URL string or configuration object');
    }

    // Validate configuration
    validateConfig(config);

    // Register any custom components defined in the config
    if (config.components) {
        registerCustomComponents(config.components);
    }

    // Set initial state if provided
    if (config.initialState) {
        initializeState(config.initialState);
    }

    // Mount the UI
    const instance = mount(config.ui || config, container, ws);

    // Set up data fetching if configured
    if (config.onMount) {
        await executeLifecycleHook(config.onMount, ws);
    }

    // Set up periodic updates if configured
    if (config.refreshInterval) {
        setupRefresh(config, instance, ws);
    }

    return instance;
}

/**
 * Fetch configuration from URL
 */
async function fetchConfig(url) {
    // Check cache first
    if (configCache.has(url)) {
        return configCache.get(url);
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load UI config: ${response.statusText}`);
        }

        const config = await response.json();

        // Cache the configuration
        configCache.set(url, config);

        return config;
    } catch (error) {
        console.error('Error loading UI configuration:', error);
        throw error;
    }
}

/**
 * Validate UI configuration
 */
function validateConfig(config) {
    if (!config) {
        throw new Error('UI configuration is required');
    }

    // Check for required fields based on config type
    if (config.version && config.version !== '1.0') {
        console.warn(`Unknown UI config version: ${config.version}`);
    }

    // Validate component structure if it's a direct component config
    if (config.type && !config.ui) {
        validateComponent(config);
    } else if (config.ui) {
        validateComponent(config.ui);
    }
}

/**
 * Validate component structure
 */
function validateComponent(component) {
    if (!component.type) {
        throw new Error('Component must have a type');
    }

    // Recursively validate children
    if (component.children && Array.isArray(component.children)) {
        component.children.forEach(validateComponent);
    }
}

/**
 * Initialize state from configuration
 */
function initializeState(initialState) {
    for (const [key, value] of Object.entries(initialState)) {
        if (typeof value === 'function') {
            // Skip functions in initial state
            continue;
        }
        state.set(key, value);
    }
}

/**
 * Register custom components from configuration
 */
function registerCustomComponents(components) {
    for (const [name, componentDef] of Object.entries(components)) {
        // Create a component class from the definition
        class CustomComponent extends Component {
            render() {
                // Use the template defined in the component
                const template = typeof componentDef.template === 'function'
                    ? componentDef.template(this.config.props || {})
                    : componentDef.template;

                // Merge props into the template
                const mergedConfig = {
                    ...template,
                    ...this.config,
                    type: template.type
                };

                // Render using the base component
                const element = document.createElement('div');
                this.element = element;

                // Render the template
                const child = renderComponent(mergedConfig, this.ws);
                if (child) {
                    this.children.push(child);
                    element.appendChild(child.element);
                }

                return element;
            }
        }

        registerComponent(name, CustomComponent);
    }
}

/**
 * Execute lifecycle hook
 */
async function executeLifecycleHook(hook, ws) {
    if (!hook) return;

    if (Array.isArray(hook)) {
        // Array of actions
        for (const action of hook) {
            await executeAction(action, ws);
        }
    } else if (typeof hook === 'object') {
        // Single action
        await executeAction(hook, ws);
    }
}

/**
 * Execute an action
 */
async function executeAction(action, ws) {
    switch (action.type) {
        case 'fetch':
            await fetchData(action, ws);
            break;
        case 'setState':
            state.set(action.path, action.value);
            break;
        case 'call':
            await callAPI(action, ws);
            break;
        default:
            console.warn(`Unknown action type: ${action.type}`);
    }
}

/**
 * Fetch data using ZeroQL
 */
async function fetchData(action, ws) {
    try {
        const { entity, operation, params, resultPath } = action;

        let result;
        if (operation && entity) {
            result = await ws.api[operation][entity](params || {});
        } else if (action.method) {
            result = await ws.call(action.method, params || {});
        }

        if (resultPath) {
            state.set(resultPath, result);
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        if (action.errorPath) {
            state.set(action.errorPath, error.message);
        }
    }
}

/**
 * Call API endpoint
 */
async function callAPI(action, ws) {
    try {
        const result = await ws.call(action.method, action.params || {});
        if (action.resultPath) {
            state.set(action.resultPath, result);
        }
    } catch (error) {
        console.error('API call error:', error);
        if (action.errorPath) {
            state.set(action.errorPath, error.message);
        }
    }
}

/**
 * Set up automatic refresh
 */
function setupRefresh(config, instance, ws) {
    const interval = setInterval(async () => {
        if (config.onRefresh) {
            await executeLifecycleHook(config.onRefresh, ws);
        }
    }, config.refreshInterval);

    // Store interval ID for cleanup
    instance.refreshInterval = interval;

    // Override destroy to clear interval
    const originalDestroy = instance.destroy;
    instance.destroy = () => {
        clearInterval(interval);
        originalDestroy?.();
    };
}

/**
 * Load UI from entity metadata
 */
export async function loadEntityUI(entityName, viewType, container, ws) {
    try {
        // Fetch entity metadata from ZeroQL
        const metadata = await ws.call('zeroql.get_entity_metadata', { entity: entityName });

        // Generate UI based on metadata and view type
        const config = generateEntityUI(metadata, viewType);

        // Load the generated UI
        return await loadUI(config, container, ws);
    } catch (error) {
        console.error(`Error loading entity UI for ${entityName}:`, error);
        throw error;
    }
}

/**
 * Generate UI configuration from entity metadata
 */
function generateEntityUI(metadata, viewType = 'list') {
    const { table_name, columns, label_field, searchable_fields } = metadata;

    switch (viewType) {
        case 'list':
            return generateListView(table_name, columns, searchable_fields);
        case 'detail':
            return generateDetailView(table_name, columns);
        case 'form':
            return generateFormView(table_name, columns);
        case 'search':
            return generateSearchView(table_name, columns, searchable_fields);
        default:
            throw new Error(`Unknown view type: ${viewType}`);
    }
}

/**
 * Generate list view configuration
 */
function generateListView(tableName, columns, searchableFields) {
    return {
        type: 'container',
        class: 'entity-list',
        children: [
            {
                type: 'h2',
                text: `${tableName} List`
            },
            {
                type: 'div',
                class: 'controls',
                children: [
                    {
                        type: 'input',
                        bind: `\${state.${tableName}.searchText}`,
                        attributes: {
                            placeholder: `Search ${tableName}...`
                        }
                    },
                    {
                        type: 'button',
                        text: 'Search',
                        onClick: {
                            actions: [
                                {
                                    type: 'call',
                                    operation: 'search',
                                    entity: tableName,
                                    params: {
                                        filters: {
                                            _search: `\${state.${tableName}.searchText}`
                                        },
                                        limit: 25
                                    },
                                    resultPath: `${tableName}.results`
                                }
                            ]
                        }
                    },
                    {
                        type: 'button',
                        text: 'New',
                        onClick: {
                            actions: [
                                {
                                    type: 'setState',
                                    path: `${tableName}.showForm`,
                                    value: true
                                }
                            ]
                        }
                    }
                ]
            },
            {
                type: 'table',
                data: `\${state.${tableName}.results.data}`,
                columns: columns.map(col => ({
                    field: col.name,
                    label: col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                })),
                onRowClick: {
                    type: 'setState',
                    path: `${tableName}.selected`,
                    value: '\${row}'
                }
            }
        ]
    };
}

/**
 * Generate detail view configuration
 */
function generateDetailView(tableName, columns) {
    return {
        type: 'container',
        class: 'entity-detail',
        children: [
            {
                type: 'h2',
                text: `${tableName} Details`
            },
            {
                type: 'if',
                condition: `\${state.${tableName}.selected}`,
                then: {
                    type: 'div',
                    class: 'detail-grid',
                    children: columns.map(col => ({
                        type: 'div',
                        class: 'detail-field',
                        children: [
                            {
                                type: 'label',
                                text: col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                            },
                            {
                                type: 'div',
                                class: 'detail-value',
                                text: `\${state.${tableName}.selected.${col.name}}`
                            }
                        ]
                    }))
                },
                else: {
                    type: 'p',
                    text: 'No item selected'
                }
            }
        ]
    };
}

/**
 * Generate form view configuration
 */
function generateFormView(tableName, columns) {
    // Filter out auto-generated columns
    const editableColumns = columns.filter(col =>
        !col.is_primary && !col.is_generated && col.name !== 'created_at' && col.name !== 'updated_at'
    );

    return {
        type: 'form',
        dataPath: `${tableName}.formData`,
        fields: editableColumns.map(col => ({
            name: col.name,
            label: col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            inputType: getInputType(col.type),
            bind: `\${state.${tableName}.formData.${col.name}}`,
            required: !col.is_nullable
        })),
        submitButton: {
            text: 'Save',
            onClick: {
                actions: [
                    {
                        type: 'call',
                        operation: 'save',
                        entity: tableName,
                        params: `\${state.${tableName}.formData}`,
                        resultPath: `${tableName}.saveResult`,
                        onSuccess: [
                            {
                                type: 'setState',
                                path: `${tableName}.showForm`,
                                value: false
                            },
                            {
                                type: 'setState',
                                path: `${tableName}.formData`,
                                value: {}
                            }
                        ]
                    }
                ]
            }
        }
    };
}

/**
 * Generate search view configuration
 */
function generateSearchView(tableName, columns, searchableFields) {
    return {
        type: 'container',
        class: 'entity-search',
        children: [
            {
                type: 'h2',
                text: `Search ${tableName}`
            },
            {
                type: 'div',
                class: 'search-filters',
                children: [
                    // Text search across searchable fields
                    {
                        type: 'div',
                        class: 'filter-group',
                        children: [
                            {
                                type: 'label',
                                text: 'Search Text'
                            },
                            {
                                type: 'input',
                                bind: `\${state.${tableName}.search._search}`,
                                attributes: {
                                    placeholder: `Search in ${searchableFields.join(', ')}`
                                }
                            }
                        ]
                    },
                    // Generate filter inputs for key columns
                    ...columns.filter(col => !col.is_generated).slice(0, 5).map(col => ({
                        type: 'div',
                        class: 'filter-group',
                        children: [
                            {
                                type: 'label',
                                text: col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                            },
                            {
                                type: 'input',
                                inputType: getInputType(col.type),
                                bind: `\${state.${tableName}.search.${col.name}}`
                            }
                        ]
                    }))
                ]
            },
            {
                type: 'button',
                text: 'Search',
                onClick: {
                    actions: [
                        {
                            type: 'call',
                            operation: 'search',
                            entity: tableName,
                            params: {
                                filters: `\${state.${tableName}.search}`,
                                limit: 50
                            },
                            resultPath: `${tableName}.searchResults`
                        }
                    ]
                }
            },
            {
                type: 'if',
                condition: `\${state.${tableName}.searchResults}`,
                then: {
                    type: 'div',
                    children: [
                        {
                            type: 'p',
                            text: `Found \${state.${tableName}.searchResults.total} results`
                        },
                        {
                            type: 'table',
                            data: `\${state.${tableName}.searchResults.data}`,
                            columns: columns.slice(0, 6).map(col => ({
                                field: col.name,
                                label: col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                            }))
                        }
                    ]
                }
            }
        ]
    };
}

/**
 * Get appropriate input type for column type
 */
function getInputType(columnType) {
    const type = columnType.toLowerCase();
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) {
        return 'number';
    } else if (type.includes('date') && !type.includes('time')) {
        return 'date';
    } else if (type.includes('datetime') || type.includes('timestamp')) {
        return 'datetime-local';
    } else if (type.includes('time')) {
        return 'time';
    } else if (type.includes('bool')) {
        return 'checkbox';
    } else if (type.includes('email')) {
        return 'email';
    } else if (type.includes('url')) {
        return 'url';
    } else if (type.includes('text') || type.includes('json')) {
        return 'textarea';
    }
    return 'text';
}

/**
 * Clear configuration cache
 */
export function clearConfigCache(url = null) {
    if (url) {
        configCache.delete(url);
    } else {
        configCache.clear();
    }
}

/**
 * Preload configurations
 */
export async function preloadConfigs(urls) {
    const promises = urls.map(url => fetchConfig(url));
    return await Promise.all(promises);
}

// Export for use in other modules
export { state };
