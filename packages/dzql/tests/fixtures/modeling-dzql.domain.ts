// Fixture: blueshed/modeling-dzql domain.ts at main 9f24585, verbatim except that
// catalogue_view and contractor_view are removed (their root tables don't exist,
// so the domain never compiled). Used as a real-world test of the path compiler.

export const entities = {
  allocations: {
    schema: {
      id: "serial PRIMARY KEY",
      from_datetime: "timestamptz",
      occasion_id: "int REFERENCES occasions(id)",
      package_id: "int REFERENCES packages(id)",
      site_id: "int REFERENCES sites(id)",
      to_datetime: "timestamptz",
    },
    permissions: {
      view: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id", "@package_id->package_offers[package_id=$].sponsor_id->user_orgs[org_id=$].user_id"],
      create: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      delete: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractors: ["@package_id->contractor_invites[package_id=$].contractor_id->user_orgs[org_id=$].user_id"],
      promoters: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      sponsors: ["@package_id->package_offers[package_id=$].sponsor_id->user_orgs[org_id=$].user_id"],
    },
  },

  areas: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
      venue_id: "int REFERENCES venues(id)",
    },
    permissions: {
      view: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      create: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      update: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  artworks: {
    schema: {
      id: "serial PRIMARY KEY",
      brand_id: "int REFERENCES brands(id)",
      height: "int",
      name: "text",
      ratio: "numeric",
      url: "text",
      width: "int",
    },
    permissions: {
      view: ["@brand_id->brands.org_id->user_orgs[org_id=$].user_id"],
      create: ["@brand_id->brands.org_id->user_orgs[org_id=$].user_id"],
      update: ["@brand_id->brands.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@brand_id->brands.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@brand_id->brands.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  audit_logs: {
    schema: {
      id: "serial PRIMARY KEY",
      action: "text",
      entity_id: "text",
      entity_type: "text",
      org_id: "text",
      payload: "jsonb",
      timestamp: "timestamptz",
      user_id: "text",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: [],
      update: [],
      delete: [],
    },
  },

  brands: {
    schema: {
      id: "serial PRIMARY KEY",
      colour_letter: "text",
      colour_one: "text",
      colour_three: "text",
      colour_two: "text",
      initial: "text",
      name: "text",
      org_id: "int",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  contractor_infos: {
    schema: {
      id: "serial PRIMARY KEY",
      contractor_id: "int",
      product_id: "int REFERENCES products(id)",
      site_id: "int REFERENCES sites(id)",
    },
    permissions: {
      view: ["@contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  contractor_info_faces: {
    schema: {
      id: "serial PRIMARY KEY",
      contractor_info_id: "int REFERENCES contractor_infos(id)",
      face_id: "int REFERENCES faces(id)",
      perf_footfall: "int",
      perf_hospitality: "int",
      perf_pr: "int",
      perf_social: "int",
      perf_tv: "int",
    },
    permissions: {
      view: ["@contractor_info_id->contractor_infos.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@contractor_info_id->contractor_infos.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@contractor_info_id->contractor_infos.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@contractor_info_id->contractor_infos.contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@contractor_info_id->contractor_infos.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  contractor_invites: {
    schema: {
      id: "serial PRIMARY KEY",
      contractor_id: "int",
      message: "text",
      package_id: "int REFERENCES packages(id)",
      sponsor_id: "int",
      status: "text",
    },
    permissions: {
      view: ["@contractor_id->user_orgs[org_id=$].user_id", "@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      create: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: ["@contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractor: ["@contractor_id->user_orgs[org_id=$].user_id"],
      promoters: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
  },

  cost_tables: {
    schema: {
      id: "serial PRIMARY KEY",
      product_id: "int REFERENCES products(id)",
      supplier_id: "int",
    },
    permissions: {
      view: ["@supplier_id->user_orgs[org_id=$].user_id"],
      create: ["@supplier_id->user_orgs[org_id=$].user_id"],
      update: ["@supplier_id->user_orgs[org_id=$].user_id"],
      delete: ["@supplier_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@supplier_id->user_orgs[org_id=$].user_id"],
    },
  },

  cost_tiers: {
    schema: {
      id: "serial PRIMARY KEY",
      cost_table_id: "int REFERENCES cost_tables(id)",
      max_quantity: "int",
      min_quantity: "int",
      unit_price: "numeric",
    },
    permissions: {
      view: ["@cost_table_id->cost_tables.supplier_id->user_orgs[org_id=$].user_id"],
      create: ["@cost_table_id->cost_tables.supplier_id->user_orgs[org_id=$].user_id"],
      update: ["@cost_table_id->cost_tables.supplier_id->user_orgs[org_id=$].user_id"],
      delete: ["@cost_table_id->cost_tables.supplier_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@cost_table_id->cost_tables.supplier_id->user_orgs[org_id=$].user_id"],
    },
  },

  events: {
    schema: {
      id: "serial PRIMARY KEY",
      from_datetime: "timestamptz",
      name: "text",
      occasion_id: "int REFERENCES occasions(id)",
      to_datetime: "timestamptz",
    },
    permissions: {
      view: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      create: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      delete: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      promoters: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
  },

  faces: {
    schema: {
      id: "serial PRIMARY KEY",
      height: "int",
      name: "text",
      orientation: "text",
      ratio: "numeric",
      specification: "jsonb",
      width: "int",
    },
    permissions: {
      view: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      create: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      update: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  face_acceptses: {
    schema: {
      id: "serial PRIMARY KEY",
    },
    permissions: {
      view: ["@face_id->faces.product_id->products.org_id->user_orgs[org_id=$].user_id"],
      create: ["@face_id->faces.product_id->products.org_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@face_id->faces.product_id->products.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  invites: {
    schema: {
      id: "serial PRIMARY KEY",
      accepted_at: "timestamptz",
      email: "text",
      expires_at: "timestamptz",
      org_id: "int",
      role: "text",
      token: "text",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
      update: [],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      invitee: ["@email"],
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  locations: {
    schema: {
      id: "serial PRIMARY KEY",
      address: "text",
      lat: "numeric",
      lng: "numeric",
      name: "text",
      org_id: "int",
      type: "text",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  moments: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
      occasion_id: "int REFERENCES occasions(id)",
      on_datetime: "timestamptz",
    },
    permissions: {
      view: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      create: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      delete: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      promoters: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
  },

  occasions: {
    schema: {
      id: "serial PRIMARY KEY",
      from_datetime: "timestamptz",
      name: "text",
      series_id: "int REFERENCES series(id)",
      to_datetime: "timestamptz",
      venue_id: "int REFERENCES venues(id)",
    },
    includes: {
      series: "series",
      venue: "venues",
    },
    permissions: {
      view: ["@id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id", "@series_id->series.authority_org_id->user_orgs[org_id=$].user_id"],
      create: ["@series_id->series.authority_org_id->user_orgs[org_id=$].user_id"],
      update: ["@id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      delete: ["@id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      promoters: ["@id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
  },

  occasion_promoters: {
    schema: {
      id: "serial PRIMARY KEY",
      occasion_id: "int REFERENCES occasions(id)",
      promoter_id: "int",
    },
    permissions: {
      view: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      create: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      promoter: ["@promoter_id->user_orgs[org_id=$].user_id"],
      promoters: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
  },

  organisations: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
    },
    permissions: {
      view: ["@id->user_orgs[org_id=$].user_id"],
      create: [],
      update: ["@id->user_orgs[org_id=$,role=owner].user_id"],
      delete: [],
    },
    notifications: {
      org_members: ["@id->user_orgs[org_id=$].user_id"],
    },
  },

  packages: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
      occasion_id: "int REFERENCES occasions(id)",
      price: "numeric",
      public: "boolean",
    },
    permissions: {
      view: ["@id->package_offers[package_id=$].sponsor_id->user_orgs[org_id=$].user_id", "@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      create: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      delete: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      contractors: ["@id->contractor_invites[package_id=$].contractor_id->user_orgs[org_id=$].user_id"],
      promoters: ["@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      sponsors: ["@id->package_offers[package_id=$].sponsor_id->user_orgs[org_id=$].user_id"],
    },
  },

  package_offers: {
    schema: {
      id: "serial PRIMARY KEY",
      package_id: "int REFERENCES packages(id)",
      sponsor_id: "int",
    },
    permissions: {
      view: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id", "@sponsor_id->user_orgs[org_id=$].user_id"],
      create: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      promoters: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      sponsor: ["@sponsor_id->user_orgs[org_id=$].user_id"],
    },
  },

  products: {
    schema: {
      id: "serial PRIMARY KEY",
      description: "text",
      name: "text",
      specification: "jsonb",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  product_parts: {
    schema: {
      id: "serial PRIMARY KEY",
      part_id: "int",
      product_id: "int REFERENCES products(id)",
      quantity: "int",
    },
    permissions: {
      view: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      create: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      update: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@product_id->products.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  profiles: {
    schema: {
      email: "text",
      user_id: "int",
    },
    permissions: {
      view: ["@id"],
      create: [],
      update: ["@id"],
      delete: [],
    },
  },

  projects: {
    schema: {
      id: "serial PRIMARY KEY",
      contractor_id: "int",
      name: "text",
      occasion_id: "int REFERENCES occasions(id)",
      status: "text",
    },
    permissions: {
      view: ["@contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@contractor_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      contractor: ["@contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  project_scenarios: {
    schema: {
      id: "serial PRIMARY KEY",
      project_id: "int REFERENCES projects(id)",
      scenario_id: "int REFERENCES scenarios(id)",
    },
    permissions: {
      view: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  resources: {
    schema: {
      id: "serial PRIMARY KEY",
      description: "text",
      name: "text",
      org_id: "int",
      product_id: "int REFERENCES products(id)",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  scenarios: {
    schema: {
      id: "serial PRIMARY KEY",
      contractor_id: "int",
      description: "text",
      name: "text",
      package_id: "int REFERENCES packages(id)",
      perf_footfall: "int",
      perf_hospitality: "int",
      perf_pr: "int",
      perf_social: "int",
      perf_tv: "int",
      sponsor_id: "int",
    },
    permissions: {
      view: ["@contractor_id->user_orgs[org_id=$].user_id", "@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id", "@sponsor_id->user_orgs[org_id=$].user_id"],
      create: ["@contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractor: ["@contractor_id->user_orgs[org_id=$].user_id"],
      promoters: ["@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id"],
      sponsor: ["@sponsor_id->user_orgs[org_id=$].user_id"],
    },
  },

  scenario_items: {
    schema: {
      id: "serial PRIMARY KEY",
      allocation_id: "int REFERENCES allocations(id)",
      product_id: "int REFERENCES products(id)",
      quantity: "int",
      scenario_id: "int REFERENCES scenarios(id)",
    },
    permissions: {
      view: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id", "@scenario_id->scenarios.sponsor_id->user_orgs[org_id=$].user_id"],
      create: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractor: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      sponsor: ["@scenario_id->scenarios.sponsor_id->user_orgs[org_id=$].user_id"],
    },
  },

  scenario_trips: {
    schema: {
      id: "serial PRIMARY KEY",
      direction: "text",
      from_location_id: "int",
      scenario_id: "int REFERENCES scenarios(id)",
      to_location_id: "int",
      vehicle_product_id: "int",
      work_day: "int",
    },
    permissions: {
      view: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id", "@scenario_id->scenarios.sponsor_id->user_orgs[org_id=$].user_id"],
      create: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractor: ["@scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  scenario_trip_manifests: {
    schema: {
      id: "serial PRIMARY KEY",
      product_id: "int REFERENCES products(id)",
      quantity: "int",
      scenario_trip_id: "int REFERENCES scenario_trips(id)",
    },
    permissions: {
      view: ["@scenario_trip_id->scenario_trips.scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@scenario_trip_id->scenario_trips.scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@scenario_trip_id->scenario_trips.scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@scenario_trip_id->scenario_trips.scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      contractor: ["@scenario_trip_id->scenario_trips.scenario_id->scenarios.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  series: {
    schema: {
      id: "serial PRIMARY KEY",
      authority_org_id: "int",
      description: "text",
      name: "text",
      year: "int",
    },
    permissions: {
      view: ["@authority_org_id->user_orgs[org_id=$].user_id"],
      create: ["@authority_org_id->user_orgs[org_id=$].user_id"],
      update: ["@authority_org_id->user_orgs[org_id=$].user_id"],
      delete: ["@authority_org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      authority: ["@authority_org_id->user_orgs[org_id=$].user_id"],
    },
  },

  sites: {
    schema: {
      id: "serial PRIMARY KEY",
      lat: "numeric",
      lng: "numeric",
      name: "text",
      venue_id: "int REFERENCES venues(id)",
    },
    permissions: {
      view: ["@area_id->areas.venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      create: ["@area_id->areas.venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      update: ["@area_id->areas.venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@area_id->areas.venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@area_id->areas.venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  skills: {
    schema: {
      id: "serial PRIMARY KEY",
      description: "text",
      multiplier: "numeric",
      name: "text",
      org_id: "int",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  stays: {
    schema: {
      id: "serial PRIMARY KEY",
      location_id: "int REFERENCES locations(id)",
      night_of: "date",
      project_id: "int REFERENCES projects(id)",
      status: "text",
      user_id: "int REFERENCES users(id)",
    },
    permissions: {
      view: ["@user_id"],
      create: ["@user_id"],
      update: ["@user_id"],
      delete: ["@user_id"],
    },
  },

  stocks: {
    schema: {
      id: "serial PRIMARY KEY",
      artwork_id: "int REFERENCES artworks(id)",
      condition: "text",
      disposition: "text",
      location_id: "int REFERENCES locations(id)",
      owner_id: "int",
      product_id: "int REFERENCES products(id)",
      serial: "text",
    },
    permissions: {
      view: ["@owner_id->user_orgs[org_id=$].user_id"],
      create: ["@owner_id->user_orgs[org_id=$].user_id"],
      update: ["@owner_id->user_orgs[org_id=$].user_id"],
      delete: ["@owner_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@owner_id->user_orgs[org_id=$].user_id"],
    },
  },

  stock_assignments: {
    schema: {
      id: "serial PRIMARY KEY",
      allocation_id: "int REFERENCES allocations(id)",
      face_id: "int REFERENCES faces(id)",
      project_id: "int REFERENCES projects(id)",
      site_id: "int REFERENCES sites(id)",
      stock_id: "int REFERENCES stocks(id)",
    },
    permissions: {
      view: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  tasks: {
    schema: {
      id: "serial PRIMARY KEY",
      allocation_id: "int REFERENCES allocations(id)",
      completed_at: "timestamptz",
      phase: "text",
      project_id: "int REFERENCES projects(id)",
      status: "text",
      work_day: "int",
      workflow_item_id: "int REFERENCES workflow_items(id)",
    },
    permissions: {
      view: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  task_assignments: {
    schema: {
      id: "serial PRIMARY KEY",
      skill_id: "int REFERENCES skills(id)",
      task_id: "int REFERENCES tasks(id)",
      user_id: "int REFERENCES users(id)",
    },
    permissions: {
      view: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id", "@user_id"],
      create: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@user_id"],
      delete: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      worker: ["@user_id"],
    },
  },

  task_dependencies: {
    schema: {
      id: "serial PRIMARY KEY",
      depends_on_id: "int",
      task_id: "int REFERENCES tasks(id)",
    },
    permissions: {
      view: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@task_id->tasks.project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  trips: {
    schema: {
      id: "serial PRIMARY KEY",
      arrival_time: "timestamptz",
      departure_time: "timestamptz",
      direction: "text",
      from_location_id: "int",
      project_id: "int REFERENCES projects(id)",
      status: "text",
      to_location_id: "int",
      vehicle_id: "int",
      work_day: "int",
    },
    permissions: {
      view: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      create: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      update: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
      delete: ["@project_id->projects.contractor_id->user_orgs[org_id=$].user_id"],
    },
  },

  trip_manifests: {
    schema: {
      id: "serial PRIMARY KEY",
      stock_id: "int REFERENCES stocks(id)",
      trip_id: "int REFERENCES trips(id)",
      user_id: "int REFERENCES users(id)",
    },
    permissions: {
      view: ["@user_id"],
      create: ["@user_id"],
      update: ["@user_id"],
      delete: ["@user_id"],
    },
  },

  users: {
    schema: {
      id: "serial PRIMARY KEY",
      email: "text",
      location_id: "int REFERENCES locations(id)",
      password: "text",
    },
    includes: {
      location: "locations",
    },
    permissions: {
      view: ["@id"],
      create: [],
      update: ["@id"],
      delete: [],
    },
  },

  user_orgs: {
    schema: {
      id: "serial PRIMARY KEY",
      org_id: "int",
      role: "text",
      user_id: "int REFERENCES users(id)",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
      update: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
      user: ["@user_id"],
    },
  },

  user_skills: {
    schema: {
      id: "serial PRIMARY KEY",
      org_id: "int",
      skill_id: "int REFERENCES skills(id)",
      user_id: "int REFERENCES users(id)",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: [],
      delete: ["@org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      user: ["@user_id"],
    },
  },

  venues: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  venue_series_applications: {
    schema: {
      id: "serial PRIMARY KEY",
      direction: "text",
      initiated_by_org_id: "int",
      message: "text",
      responded_at: "timestamptz",
      series_id: "int REFERENCES series(id)",
      status: "text",
      venue_id: "int REFERENCES venues(id)",
    },
    permissions: {
      view: ["@series_id->series.authority_org_id->user_orgs[org_id=$].user_id", "@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      create: ["@series_id->series.authority_org_id->user_orgs[org_id=$].user_id", "@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      update: ["@series_id->series.authority_org_id->user_orgs[org_id=$].user_id", "@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
      delete: [],
    },
    notifications: {
      authority: ["@series_id->series.authority_org_id->user_orgs[org_id=$].user_id"],
      venue: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  workflows: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text",
      product_id: "int REFERENCES products(id)",
      type: "text",
    },
    permissions: {
      view: ["@org_id->user_orgs[org_id=$].user_id"],
      create: ["@org_id->user_orgs[org_id=$].user_id"],
      update: ["@org_id->user_orgs[org_id=$].user_id"],
      delete: ["@org_id->user_orgs[org_id=$,role=owner].user_id"],
    },
    notifications: {
      org_members: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },

  workflow_items: {
    schema: {
      id: "serial PRIMARY KEY",
      description: "text",
      name: "text",
      workflow_id: "int REFERENCES workflows(id)",
    },
    permissions: {
      view: ["@workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      create: ["@workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      update: ["@workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
    },
    notifications: {
      org_members: ["@workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  workflow_item_dependencies: {
    schema: {
      id: "serial PRIMARY KEY",
      depends_on_id: "int",
      item_id: "int",
    },
    permissions: {
      view: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      create: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      update: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  workflow_item_resources: {
    schema: {
      id: "serial PRIMARY KEY",
      exclusive: "boolean",
      item_id: "int",
      quantity: "int",
      resource_id: "int REFERENCES resources(id)",
    },
    permissions: {
      view: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      create: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      update: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
    },
  },

  workflow_item_skills: {
    schema: {
      id: "serial PRIMARY KEY",
      duration: "int",
      item_id: "int",
      skill_id: "int REFERENCES skills(id)",
    },
    permissions: {
      view: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      create: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      update: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
      delete: ["@workflow_item_id->workflow_items.workflow_id->workflows.org_id->user_orgs[org_id=$].user_id"],
    },
  },

};

export const subscribables = {


  occasion_view: {
      "params": {
          "occasion_id": "int"
      },
      "root": {
          "entity": "occasions",
          "key": "occasion_id"
      },
      "includes": {
          "allocation": "allocations",
          "event": "events",
          "moment": "moments",
          "occasion": "occasions",
          "occasionpromoter": "occasion_promoters",
          "package": "packages"
      },
      "scopeTables": [
          "allocations",
          "events",
          "moments",
          "occasion_promoters",
          "occasions",
          "packages"
      ],
      "canSubscribe": []
  },

  package_view: {
      "params": {
          "package_id": "int"
      },
      "root": {
          "entity": "packages",
          "key": "package_id"
      },
      "includes": {
          "allocation": "allocations",
          "occasion": "occasions",
          "package": "packages",
          "packageoffer": "package_offers",
          "scenario": "scenarios",
          "site": "sites",
          "venue": "venues"
      },
      "scopeTables": [
          "allocations",
          "occasions",
          "package_offers",
          "packages",
          "scenarios",
          "sites",
          "venues"
      ],
      "canSubscribe": []
  },

  scenario_view: {
      "params": {
          "scenario_id": "int"
      },
      "root": {
          "entity": "scenarios",
          "key": "scenario_id"
      },
      "includes": {
          "allocation": "allocations",
          "costtable": "cost_tables",
          "package": "packages",
          "product": "products",
          "scenario": "scenarios",
          "scenarioitem": "scenario_items",
          "scenariotrip": "scenario_trips",
          "scenariotripmanifest": "scenario_trip_manifests",
          "site": "sites",
          "stock": "stocks"
      },
      "scopeTables": [
          "allocations",
          "cost_tables",
          "packages",
          "products",
          "scenario_items",
          "scenario_trip_manifests",
          "scenario_trips",
          "scenarios",
          "sites",
          "stocks"
      ],
      "canSubscribe": []
  },

  series_view: {
      "params": {
          "series_id": "int"
      },
      "root": {
          "entity": "series",
          "key": "series_id"
      },
      "includes": {
          "occasion": "occasions",
          "series": "series",
          "venue": "venues",
          "venueseriesapplication": "venue_series_applications"
      },
      "scopeTables": [
          "occasions",
          "series",
          "venue_series_applications",
          "venues"
      ],
      "canSubscribe": []
  },

  venue_view: {
      "params": {
          "venue_id": "int"
      },
      "root": {
          "entity": "venues",
          "key": "venue_id"
      },
      "includes": {
          "area": "areas",
          "contractorinfo": "contractor_infos",
          "site": "sites",
          "venue": "venues"
      },
      "scopeTables": [
          "areas",
          "contractor_infos",
          "sites",
          "venues"
      ],
      "canSubscribe": []
  },

};

export default {
  entities,
  subscribables,
};

