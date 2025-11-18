
import { WebSocketManager } from 'dzql/client';
import { loadUI, loadEntityUI, clearConfigCache } from '../src/ui-loader.js';
import { state } from '../src/ui.js';

// Global references
window.ws = new WebSocketManager();
window.currentUI = null;

// Initialize connection
async function init() {
    const statusEl = document.getElementById('connectionStatus');

    try {
        statusEl.textContent = 'Connecting...';
        statusEl.className = 'status connecting';

        await window.ws.connect();

        statusEl.textContent = 'Connected';
        statusEl.className = 'status connected';

        // Load default UI
        applyInlineConfig();

        // Listen for real-time events
        window.ws.onBroadcast((method, params) => {
            console.log('Real-time event:', method, params);

            // Update state with events
            const events = state.get('events') || [];
            events.unshift({
                timestamp: new Date().toISOString(),
                method,
                params
            });
            if (events.length > 50) events.pop();
            state.set('events', events);
        });

    } catch (error) {
        console.error('Connection failed:', error);
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status disconnected';

        document.getElementById('app').innerHTML = `
            <div class="error-message">
                <h3>Connection Failed</h3>
                <p>${error.message}</p>
                <p>Make sure the DZQL server is running on port 3000.</p>
                <button onclick="location.reload()">Retry</button>
            </div>
        `;
    }
}

// Load pre-built configuration
window.loadPrebuiltConfig = async function(configName) {
    // Clear previous selection
    document.querySelectorAll('.config-card').forEach(card => {
        card.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    try {
        let config;

        // Load the appropriate configuration
        if (configName === 'venue-manager') {
            config = await fetch('./ui-configs/venue-manager.json').then(r => r.json());
        } else {
            // Generate config based on type
            config = generateConfig(configName);
        }

        // Update editor
        document.getElementById('configEditor').value = JSON.stringify(config, null, 2);

        // Apply configuration
        applyConfig(config);

    } catch (error) {
        console.error('Error loading configuration:', error);
        showError(`Failed to load ${configName} configuration: ${error.message}`);
    }
};

// Generate configuration
function generateConfig(type) {
    switch (type) {
        case 'simple-search':
            return {
                type: 'container',
                children: [
                    {
                        type: 'h2',
                        text: 'Simple Search Interface'
                    },
                    {
                        type: 'div',
                        class: 'search-container',
                        children: [
                            {
                                type: 'input',
                                bind: '${state.searchQuery}',
                                attributes: { placeholder: 'Enter search term...' }
                            },
                            {
                                type: 'button',
                                text: 'Search',
                                onClick: {
                                    actions: [{
                                        type: 'call',
                                        operation: 'search',
                                        entity: 'venues',
                                        params: {
                                            filters: { _search: '${state.searchQuery}' },
                                            limit: 10
                                        },
                                        resultPath: 'searchResults'
                                    }]
                                }
                            }
                        ]
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
                                    data: '${state.searchResults.data}'
                                }
                            ]
                        }
                    }
                ]
            };

        case 'dashboard':
            return {
                type: 'container',
                children: [
                    {
                        type: 'h2',
                        text: 'Dashboard'
                    },
                    {
                        type: 'div',
                        class: 'stats',
                        children: [
                            {
                                type: 'div',
                                class: 'stat-card',
                                children: [
                                    { type: 'h3', text: 'Total Items' },
                                    { type: 'div', class: 'stat-value', text: '${state.stats.total || 0}' }
                                ]
                            },
                            {
                                type: 'div',
                                class: 'stat-card',
                                children: [
                                    { type: 'h3', text: 'Active Items' },
                                    { type: 'div', class: 'stat-value', text: '${state.stats.active || 0}' }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'button',
                        text: 'Refresh Stats',
                        onClick: {
                            actions: [{
                                type: 'setState',
                                path: 'stats',
                                value: { total: Math.floor(Math.random() * 100), active: Math.floor(Math.random() * 50) }
                            }]
                        }
                    }
                ]
            };

        case 'form-builder':
            return {
                type: 'form',
                dataPath: 'formData',
                fields: [
                    {
                        name: 'name',
                        label: 'Name',
                        inputType: 'text',
                        bind: '${state.formData.name}',
                        required: true
                    },
                    {
                        name: 'email',
                        label: 'Email',
                        inputType: 'email',
                        bind: '${state.formData.email}',
                        required: true
                    },
                    {
                        name: 'message',
                        label: 'Message',
                        inputType: 'textarea',
                        bind: '${state.formData.message}'
                    }
                ],
                submitButton: {
                    text: 'Submit',
                    onClick: {
                        actions: [{
                            type: 'alert',
                            message: 'Form submitted with: ${JSON.stringify(state.formData)}'
                        }]
                    }
                }
            };

        default:
            throw new Error(`Unknown configuration type: ${type}`);
    }
}

// Apply inline configuration
window.applyInlineConfig = function() {
    const configText = document.getElementById('configEditor').value;

    try {
        const config = JSON.parse(configText);
        applyConfig(config);
        document.getElementById('configError').innerHTML = '';
    } catch (error) {
        showError(`Invalid JSON: ${error.message}`);
    }
};

// Apply configuration
function applyConfig(config) {
    // Destroy current UI
    if (window.currentUI) {
        window.currentUI.destroy();
    }

    // Load new UI
    window.currentUI = loadUI(config, document.getElementById('app'), window.ws);
}

// Load from URL
window.loadFromUrl = async function() {
    const url = prompt('Enter the URL of the UI configuration JSON file:');
    if (!url) return;

    try {
        const response = await fetch(url);
        const config = await response.json();

        document.getElementById('configEditor').value = JSON.stringify(config, null, 2);
        applyConfig(config);
    } catch (error) {
        showError(`Failed to load from URL: ${error.message}`);
    }
};

// Generate from entity
window.generateFromEntity = async function() {
    const entity = prompt('Enter entity name (e.g., venues, organisations):');
    if (!entity) return;

    const viewType = prompt('Enter view type (list, detail, form, search):', 'list');
    if (!viewType) return;

    try {
        if (window.currentUI) {
            window.currentUI.destroy();
        }

        window.currentUI = await loadEntityUI(entity, viewType, document.getElementById('app'), window.ws);
        document.getElementById('configError').innerHTML = '';
    } catch (error) {
        showError(`Failed to generate UI for entity: ${error.message}`);
    }
};

// Clear UI
window.clearUI = function() {
    if (window.currentUI) {
        window.currentUI.destroy();
        window.currentUI = null;
    }

    document.getElementById('app').innerHTML = '<p>No UI loaded. Select a configuration or write your own.</p>';
    document.getElementById('configEditor').value = '';
    document.querySelectorAll('.config-card').forEach(card => {
        card.classList.remove('active');
    });
};

// Format JSON
window.formatJSON = function() {
    try {
        const config = JSON.parse(document.getElementById('configEditor').value);
        document.getElementById('configEditor').value = JSON.stringify(config, null, 2);
        document.getElementById('configError').innerHTML = '';
    } catch (error) {
        showError(`Invalid JSON: ${error.message}`);
    }
};

// Validate JSON
window.validateJSON = function() {
    try {
        JSON.parse(document.getElementById('configEditor').value);
        document.getElementById('configError').innerHTML = '<div style="color: green;">✓ Valid JSON</div>';
    } catch (error) {
        showError(`Invalid JSON: ${error.message}`);
    }
};

// Show error
function showError(message) {
    document.getElementById('configError').innerHTML = `<div class="error-message">${message}</div>`;
}

// Start the application
init();
