// Rights Management UI Configuration
export const uiConfig = {
    type: 'container',
    class: 'app',
    children: [
        // Header
        {
            type: 'div',
            class: 'header',
            children: [
                { type: 'h1', text: '🏛️ Rights Management' },
                { type: 'p', text: 'Manage venues, packages, and contractor rights' },
                {
                    type: 'span',
                    class: '${state.wsStatus === "connected" ? "status connected" : "status disconnected"}',
                    text: '${state.wsStatus || "disconnected"}'
                }
            ]
        },

        // Navigation tabs
        {
            type: 'div',
            class: 'nav-bar',
            children: [{
                type: 'div',
                class: 'nav-tabs',
                children: [
                    'dashboard', 'organisations', 'venues', 'packages', 'allocations', 'rights'
                ].map(tab => ({
                    type: 'button',
                    class: '${state.activeTab === "' + tab + '" ? "tab active" : "tab"}',
                    text: tab.charAt(0).toUpperCase() + tab.slice(1),
                    onClick: {
                        actions: [
                            { type: 'setState', path: 'activeTab', value: tab },
                            tab !== 'dashboard' ? {
                                type: 'call',
                                operation: 'search',
                                entity: tab === 'rights' ? 'contractor_rights' : tab,
                                params: { limit: 25 },
                                resultPath: tab + '.list'
                            } : null
                        ].filter(Boolean)
                    }
                }))
            }]
        },

        // Content area
        {
            type: 'div',
            class: 'content',
            children: [
                // Dashboard
                {
                    type: 'if',
                    condition: "${state.activeTab === 'dashboard'}",
                    then: {
                        type: 'section',
                        children: [
                            { type: 'h2', text: 'Dashboard' },
                            {
                                type: 'div',
                                class: 'grid',
                                children: ['venues', 'packages', 'allocations', 'organisations'].map(entity => ({
                                    type: 'div',
                                    class: 'card',
                                    children: [
                                        { type: 'h3', text: entity.charAt(0).toUpperCase() + entity.slice(1) },
                                        { type: 'div', class: 'stat-value', text: '${state.stats?.' + entity + ' || "..."}' },
                                        { type: 'div', class: 'stat-label', text: 'Total ' + entity }
                                    ]
                                }))
                            }
                        ]
                    }
                },

                // Entity views (organisations, venues, packages, allocations)
                ...['organisations', 'venues', 'packages', 'allocations'].map(entity => ({
                    type: 'if',
                    condition: "${state.activeTab === '" + entity + "'}",
                    then: {
                        type: 'section',
                        children: [
                            { type: 'h2', text: entity.charAt(0).toUpperCase() + entity.slice(1) },
                            {
                                type: 'div',
                                class: 'search-bar',
                                children: [
                                    {
                                        type: 'input',
                                        bind: '${state.' + entity + '.search}',
                                        attributes: { placeholder: 'Search ' + entity + '...' }
                                    },
                                    {
                                        type: 'button',
                                        text: 'Search',
                                        onClick: {
                                            actions: [{
                                                type: 'call',
                                                operation: 'search',
                                                entity: entity,
                                                params: {
                                                    filters: { _search: '${state.' + entity + '.search}' },
                                                    limit: 25
                                                },
                                                resultPath: entity + '.list'
                                            }]
                                        }
                                    }
                                ]
                            },
                            {
                                type: 'if',
                                condition: '${state.' + entity + '.list}',
                                then: {
                                    type: 'table',
                                    data: '${state.' + entity + '.list.data}',
                                    columns: getColumnsForEntity(entity)
                                }
                            }
                        ]
                    }
                })),

                // Rights view
                {
                    type: 'if',
                    condition: "${state.activeTab === 'rights'}",
                    then: {
                        type: 'section',
                        children: [
                            { type: 'h2', text: 'Rights Management' },
                            {
                                type: 'div',
                                class: 'pill-nav',
                                children: ['contractor', 'promotion'].map(type => ({
                                    type: 'button',
                                    class: '${state.rightsType === "' + type + '" ? "pill active" : "pill"}',
                                    text: type.charAt(0).toUpperCase() + type.slice(1) + ' Rights',
                                    onClick: {
                                        actions: [
                                            { type: 'setState', path: 'rightsType', value: type },
                                            {
                                                type: 'call',
                                                operation: 'search',
                                                entity: type + '_rights',
                                                params: { limit: 25 },
                                                resultPath: 'rights.' + type
                                            }
                                        ]
                                    }
                                }))
                            },
                            {
                                type: 'if',
                                condition: '${state.rights.contractor}',
                                then: {
                                    type: 'table',
                                    data: '${state.rights.contractor.data}',
                                    columns: [
                                        { field: 'contractor_org.name', label: 'Contractor' },
                                        { field: 'venue.name', label: 'Venue' },
                                        { field: 'valid_from', label: 'From' },
                                        { field: 'valid_to', label: 'To' }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        }
    ]
};

// Helper function for table columns
function getColumnsForEntity(entity) {
    const columnSets = {
        organisations: [
            { field: 'id', label: 'ID' },
            { field: 'name', label: 'Name' },
            { field: 'description', label: 'Description' }
        ],
        venues: [
            { field: 'id', label: 'ID' },
            { field: 'name', label: 'Name' },
            { field: 'address', label: 'Address' },
            { field: 'org.name', label: 'Organisation' }
        ],
        packages: [
            { field: 'id', label: 'ID' },
            { field: 'name', label: 'Name' },
            { field: 'owner.name', label: 'Owner' },
            { field: 'sponsor.name', label: 'Sponsor' }
        ],
        allocations: [
            { field: 'id', label: 'ID' },
            { field: 'package.name', label: 'Package' },
            { field: 'site.name', label: 'Site' },
            { field: 'from_datetime', label: 'From' }
        ]
    };
    return columnSets[entity] || [];
}
