// venues-domain.js - v2 format
// Complete domain definition: all tables, all config

export const entities = {

  // === Users ===
  users: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL',
      email: 'text UNIQUE NOT NULL',
      password_hash: 'text NOT NULL',
      created_at: 'timestamptz DEFAULT now()'
    },
    label: 'name',
    searchable: ['name', 'email'],
    hidden: ['password_hash'],
    permissions: {
      view: [],
      create: [],
      update: ['@id'],
      delete: ['@id']
    }
  },

  // === Organisations ===
  organisations: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text UNIQUE NOT NULL',
      description: 'text'
    },
    label: 'name',
    searchable: ['name', 'description'],
    permissions: {
      view: [],
      create: [],
      update: ['@id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@id->acts_for[org_id=$]{active}.user_id']
    },
    graphRules: {
      on_create: {
        establish_ownership: {
          description: 'Creator becomes owner',
          actions: [
            {
              type: 'create',
              entity: 'acts_for',
              data: {
                user_id: '@user_id',
                org_id: '@id',
                valid_from: '@today'
              }
            }
          ]
        }
      },
      on_delete: {
        cleanup_relationships: {
          description: 'Cascading delete for related entities',
          actions: [
            { type: 'delete', target: 'acts_for', params: { org_id: '@id' } },
            { type: 'delete', target: 'venues', params: { org_id: '@id' } },
            { type: 'update', target: 'packages', params: { sponsor_org_id: '@id' }, data: { sponsor_org_id: null } } // SET NULL example
          ]
        }
      }
    }
  },

  // === Acts For (temporal, composite PK) ===
  acts_for: {
    schema: {
      user_id: 'int NOT NULL REFERENCES users(id)',
      org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      valid_from: 'date NOT NULL DEFAULT current_date',
      valid_to: 'date',
      active: 'boolean DEFAULT true' // Added for permission check compatibility
    },
    primaryKey: ['user_id', 'org_id', 'valid_from'],
    label: 'org_id',
    searchable: ['org_id', 'user_id'],
    includes: {
      user: 'users',
      org: 'organisations'
    },
    temporal: {
      validFrom: 'valid_from',
      validTo: 'valid_to'
    },
    permissions: {}
  },

  // === Venues ===
  venues: {
    schema: {
      id: 'serial PRIMARY KEY',
      org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      name: 'text UNIQUE NOT NULL',
      address: 'text NOT NULL',
      description: 'text'
    },
    label: 'name',
    searchable: ['name', 'address', 'description'],
    includes: {
      org: 'organisations',
      sites: 'sites'
    },
    permissions: {
      view: [],
      create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      ownership: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Sites ===
  sites: {
    schema: {
      id: 'serial PRIMARY KEY',
      venue_id: 'int NOT NULL REFERENCES venues(id)',
      name: 'text NOT NULL',
      description: 'text'
    },
    label: 'name',
    searchable: ['name', 'description'],
    includes: {
      venue: 'venues'
    },
    permissions: {
      view: [],
      create: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      ownership: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Products (with soft delete and field defaults) ===
  products: {
    schema: {
      id: 'serial PRIMARY KEY',
      org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      name: 'text UNIQUE NOT NULL',
      description: 'text',
      price: 'decimal(10, 2) NOT NULL DEFAULT 0.00',
      created_by: 'int REFERENCES users(id)',
      created_at: 'timestamptz',
      deleted_at: 'timestamptz'  // For soft delete
    },
    label: 'name',
    searchable: ['name', 'description'],
    includes: {
      org: 'organisations'
    },
    // Soft delete - sets deleted_at instead of DELETE
    softDelete: true,
    // Auto-populate on INSERT
    fieldDefaults: {
      created_by: '@user_id',
      created_at: '@now'
    },
    permissions: {
      view: [],
      create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      ownership: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Packages (with CHECK constraint) ===
  packages: {
    schema: {
      id: 'serial PRIMARY KEY',
      owner_org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      sponsor_org_id: 'int REFERENCES organisations(id) ON DELETE SET NULL',
      name: 'text NOT NULL',
      price: 'decimal(10, 2) NOT NULL DEFAULT 0.00',
      status: "text NOT NULL DEFAULT 'draft'"
    },
    constraints: [
      "CHECK (status IN ('draft', 'available', 'sold', 'expired'))"
    ],
    label: 'name',
    searchable: ['name'],
    includes: {
      owner_org: 'organisations',
      sponsor_org: 'organisations'
    },
    permissions: {
      view: [
        '@owner_org_id->acts_for[org_id=$]{active}.user_id',
        '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      create: [
        '@owner_org_id->acts_for[org_id=$]{active}.user_id',
        '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      update: [
        '@owner_org_id->acts_for[org_id=$]{active}.user_id',
        '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      delete: ['@owner_org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      ownership: ['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
      commercial: ['@sponsor_org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Allocations (complex permission paths) ===
  allocations: {
    schema: {
      id: 'serial PRIMARY KEY',
      package_id: 'int NOT NULL REFERENCES packages(id)',
      site_id: 'int NOT NULL REFERENCES sites(id)',
      from_date: 'date NOT NULL',
      to_date: 'date NOT NULL'
    },
    label: 'id',
    searchable: ['site_id'],
    includes: {
      package: 'packages',
      site: 'sites'
    },
    permissions: {
      view: [
        '@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id',
        '@package_id->packages.owner_org_id->acts_for[org_id=$]{active}.user_id',
        '@package_id->packages.sponsor_org_id->acts_for[org_id=$]{active}.user_id',
        'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      create: ['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
      update: [
        '@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id',
        '@package_id->packages.owner_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      delete: ['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      ownership: ['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
      commercial: [
        '@package_id->packages.owner_org_id->acts_for[org_id=$]{active}.user_id',
        '@package_id->packages.sponsor_org_id->acts_for[org_id=$]{active}.user_id'
      ],
      delegated: [
        'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
      ]
    }
  },

  // === Contractor Rights (composite PK, temporal) ===
  contractor_rights: {
    schema: {
      contractor_org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      sponsor_org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      package_id: 'int NOT NULL REFERENCES packages(id) ON DELETE CASCADE',
      valid_from: 'date NOT NULL DEFAULT current_date',
      valid_to: 'date'
    },
    primaryKey: ['contractor_org_id', 'package_id', 'valid_from'],
    label: 'contractor_org_id',
    searchable: ['contractor_org_id', 'sponsor_org_id'],
    includes: {
      contractor_org: 'organisations',
      sponsor_org: 'organisations',
      package: 'packages'
    },
    temporal: {
      validFrom: 'valid_from',
      validTo: 'valid_to'
    },
    permissions: {
      view: [],
      create: ['@sponsor_org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@sponsor_org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@sponsor_org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      parties: [
        '@contractor_org_id->acts_for[org_id=$]{active}.user_id',
        '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
      ]
    }
  },

  // === Brands (with M2M tags) ===
  brands: {
    schema: {
      id: 'serial PRIMARY KEY',
      org_id: 'int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE',
      name: 'text NOT NULL',
      description: 'text'
    },
    constraints: [
      'UNIQUE(org_id, name)'
    ],
    indexes: [
      'CREATE INDEX idx_brands_org_id ON brands(org_id)'
    ],
    label: 'name',
    searchable: ['name', 'description'],
    includes: {
      org: 'organisations',
      artwork: 'artwork'
    },
    manyToMany: {
      tags: {
        junctionTable: 'brand_tags',
        localKey: 'brand_id',
        foreignKey: 'tag_id',
        targetEntity: 'tags',
        idField: 'tag_ids',
        expand: false
      }
    },
    permissions: {
      view: [],
      create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      org_members: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Artwork ===
  artwork: {
    schema: {
      id: 'serial PRIMARY KEY',
      brand_id: 'int NOT NULL REFERENCES brands(id) ON DELETE CASCADE',
      url: 'text NOT NULL',
      ratio: 'decimal(10, 4) NOT NULL'
    },
    constraints: [
      'CHECK (ratio > 0)'
    ],
    indexes: [
      'CREATE INDEX idx_artwork_brand_id ON artwork(brand_id)'
    ],
    label: 'url',
    searchable: ['url'],
    includes: {
      brand: 'brands'
    },
    permissions: {
      view: [],
      create: ['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id'],
      delete: ['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id']
    },
    notifications: {
      brand_org_members: ['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id']
    }
  },

  // === Tags ===
  tags: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL UNIQUE',
      color: 'text',
      description: 'text'
    },
    label: 'name',
    searchable: ['name', 'description'],
    permissions: {
      view: [],
      create: [],
      update: [],
      delete: []
    }
  },

  // === Brand Tags (junction table) ===
  brand_tags: {
    schema: {
      brand_id: 'int NOT NULL REFERENCES brands(id) ON DELETE CASCADE',
      tag_id: 'int NOT NULL REFERENCES tags(id) ON DELETE CASCADE'
    },
    primaryKey: ['brand_id', 'tag_id'],
    indexes: [
      'CREATE INDEX idx_brand_tags_tag_id ON brand_tags(tag_id)'
    ],
    // Junction tables typically don't need DZQL CRUD - managed via M2M
    managed: false
  }

};

// === Subscribables (real-time documents) ===
export const subscribables = {

  // Venue detail - venue with org, sites, and allocations
  venue_detail: {
    params: {
      venue_id: 'int'
    },
    root: {
      entity: 'venues',
      key: 'venue_id'
    },
    includes: {
      org: 'organisations',
      sites: {
        entity: 'sites',
        includes: {
          allocations: 'allocations'
        }
      }
    },
    // Tables that affect this document - for subscription routing
    scopeTables: ['venues', 'organisations', 'sites', 'allocations'],
    // Who can subscribe
    canSubscribe: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
  },

  // Org dashboard - everything an organisation member sees
  org_dashboard: {
    params: {
      org_id: 'int'
    },
    root: {
      entity: 'organisations',
      key: 'org_id'
    },
    includes: {
      venues: {
        entity: 'venues',
        filter: { org_id: '@org_id' },
        includes: {
          sites: 'sites'
        }
      },
      products: {
        entity: 'products',
        filter: { org_id: '@org_id' }
      },
      packages: {
        entity: 'packages',
        filter: { owner_org_id: '@org_id' }
      },
      brands: {
        entity: 'brands',
        filter: { org_id: '@org_id' },
        includes: {
          artwork: 'artwork'
        }
      }
    },
    scopeTables: ['organisations', 'venues', 'sites', 'products', 'packages', 'brands', 'artwork'],
    canSubscribe: ['@org_id->acts_for[org_id=$]{active}.user_id']
  },

  // User profile - current user's orgs and roles
  my_profile: {
    params: {},  // No params - uses current user
    root: {
      entity: 'users',
      key: '@user_id'  // Built-in: current user
    },
    includes: {
      memberships: {
        entity: 'acts_for',
        filter: { user_id: '@user_id' },
        temporal: true,  // Only active memberships
        includes: {
          org: 'organisations'
        }
      }
    },
    scopeTables: ['users', 'acts_for', 'organisations'],
    canSubscribe: []  // Anyone authenticated can subscribe to their own profile
  }

};