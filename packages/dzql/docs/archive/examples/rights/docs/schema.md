# Database Schema

## Core Entities

### Users
- id: serial
- email: string unique
- name: string
- password_hash: string

### Organisations
- id: serial
- name: string unique
- description: string

### acts_for
- user_id: int → Users.id
- org_id: int → Organisations.id
- valid_from: date
- valid_to: date
- PRIMARY KEY (user_id, org_id, valid_from)

### Venues
- id: serial
- org_id: int → Organisations.id
- name: string unique
- address: string
- description: string
- lat: decimal
- lng: decimal

### Areas
- id: serial
- venue_id: int → Venues.id
- parent_id: int → Areas.id (nullable)
- group_id: int
- name: string
- description: string

### Sites
- id: serial
- venue_id: int → Venues.id
- area_id: int → Areas.id
- name: string
- description: string
- lat: decimal
- lng: decimal

### Products
- id: serial
- owner_org_id: int → Organisations.id
- name: string unique
- description: string
- dimensions: jsonb

### SiteProducts
- site_id: int → Sites.id
- product_id: int → Products.id
- PRIMARY KEY (site_id, product_id)

## Inventory Management

### SiteInfo
- id: serial
- site_id: int → Sites.id
- contractor_org_id: int → Organisations.id
- dimensions: string
- notes: text

### Modules
- id: serial
- contractor_org_id: int → Organisations.id
- name: string
- dimensions: string

### Components
- id: serial
- name: string
- type: enum(structural, hardware, tool, accessory)
- description: string
- specifications: string
- unit: string

### ModuleComponents
- id: serial
- module_id: int → Modules.id
- component_id: int → Components.id
- quantity: int
- notes: text
- PRIMARY KEY (module_id, component_id)

### ModuleItems
- id: serial
- module_id: int → Modules.id
- barcode: string unique
- location: string
- notes: text

### ProductItems
- id: serial
- product_id: int → Products.id
- sponsor_id: int → Organisations.id
- contractor_org_id: int → Organisations.id
- barcode: string unique
- location: string
- notes: text

### InventoryAllocations
- id: serial
- sponsor_selection_id: int → SponsorSelections.id
- module_item_id: int → ModuleItems.id (nullable)
- product_item_id: int → ProductItems.id (nullable)
- allocated_at: timestamp
- returned_at: timestamp (nullable)
- return_condition: enum(good, damaged, lost) (nullable)
- condition_notes: text (nullable)

## Physical Structure

### SiteModules
- id: serial
- site_id: int → Sites.id
- module_id: int → Modules.id
- PRIMARY KEY (site_id, module_id)

### Faces
- id: serial
- module_id: int → Modules.id
- name: string
- sequence: int
- orientation: int (0-359)
- dimensions: string

### FaceProducts
- id: serial
- face_id: int → Faces.id
- product_id: int → Products.id
- PRIMARY KEY (face_id, product_id)

### Performance
- id: serial
- site_id: int → Sites.id
- face_id: int → Faces.id
- product_id: int → Products.id
- tv_score: int (0-3)
- social_score: int (0-3)
- footfall_score: int (0-3)
- hospitality_score: int (0-3)
- PRIMARY KEY (site_id, face_id, product_id)

## Rights Management

### ContractorRights
- id: serial
- contractor_org_id: int → Organisations.id
- granted_by_type: enum(owner, sponsor)
- granted_by_id: int → Organisations.id
- venue_id: int → Venues.id
- valid_from: date
- valid_to: date (nullable)

## Events & Timing

### Occasions
- id: serial
- venue_id: int → Venues.id
- name: string
- from_date: date
- to_date: date

### Events
- id: serial
- occasion_id: int → Occasions.id
- name: string
- from_datetime: timestamp
- to_datetime: timestamp

### Moments
- id: serial
- occasion_id: int → Occasions.id
- name: string
- at_datetime: timestamp

### PromotionRights
- id: serial
- owner_id: int → Organisations.id
- promoter_id: int → Organisations.id
- occasion_id: int → Occasions.id
- valid_from: date
- valid_to: date (nullable)
- PRIMARY KEY (owner_id, promoter_id, occasion_id, valid_from)

## Commercial Operations

### Packages
- id: serial
- occasion_id: int → Occasions.id (nullable)
- owner_id: int → Organisations.id
- promoter_id: int → Organisations.id (nullable)
- sponsor_id: int → Organisations.id (nullable)
- name: string
- is_public: bool

### Campaigns
- id: serial
- sponsor_id: int → Organisations.id
- name: string
- description: text

### CampaignPackages
- id: serial
- campaign_id: int → Campaigns.id
- package_id: int → Packages.id
- PRIMARY KEY (campaign_id, package_id)

### PackageProposals
- id: serial
- package_id: int → Packages.id
- proposed_by_id: int → Organisations.id
- proposed_to_id: int → Organisations.id
- status: enum(pending, accepted, rejected)
- notes: text

### Allocations
- id: serial
- package_id: int → Packages.id
- site_id: int → Sites.id
- from_datetime: timestamp
- to_datetime: timestamp

### SponsorBriefs
- id: serial
- sponsor_id: int → Organisations.id
- occasion_id: int → Occasions.id
- contractor_org_id: int → Organisations.id
- tv_priority: int (0-3)
- social_priority: int (0-3)
- footfall_priority: int (0-3)
- hospitality_priority: int (0-3)
- notes: text
- plan_assessment_tv_score: int (0-3) (nullable)
- plan_assessment_social_score: int (0-3) (nullable)
- plan_assessment_footfall_score: int (0-3) (nullable)
- plan_assessment_hospitality_score: int (0-3) (nullable)
- plan_assessment_notes: text (nullable)
- execution_assessment_tv_score: int (0-3) (nullable)
- execution_assessment_social_score: int (0-3) (nullable)
- execution_assessment_footfall_score: int (0-3) (nullable)
- execution_assessment_hospitality_score: int (0-3) (nullable)
- execution_assessment_notes: text (nullable)
- PRIMARY KEY (sponsor_id, occasion_id, contractor_org_id)

### AllocationOptions
- id: serial
- allocation_id: int → Allocations.id
- module_id: int → Modules.id
- face_id: int → Faces.id
- product_id: int → Products.id
- contractor_notes: text

### SponsorSelections
- id: serial
- allocation_id: int → Allocations.id
- option_id: int → AllocationOptions.id
- procurement: enum(buy_new, use_stock)
- sponsor_notes: text
- PRIMARY KEY (allocation_id)

## Task Management

### Tasks
- id: serial
- name: string
- description: text
- duration: interval
- assigned_to: int → Users.id (nullable)
- team_id: int → Teams.id (nullable)
- work_window_id: int → WorkWindows.id (nullable)
- completed_by: int → Users.id (nullable)
- started: timestamp (nullable)
- completed: timestamp (nullable)

### Teams
- id: serial
- contractor_org_id: int → Organisations.id
- occasion_id: int → Occasions.id
- name: string

### TeamMembers
- id: serial
- team_id: int → Teams.id
- user_id: int → Users.id
- PRIMARY KEY (team_id, user_id)

### WorkWindows
- id: serial
- occasion_id: int → Occasions.id
- name: string
- from_datetime: timestamp
- to_datetime: timestamp

### TaskDependencies
- id: serial
- task_id: int → Tasks.id
- depends_on_id: int → Tasks.id
- PRIMARY KEY (task_id, depends_on_id)

### TaskResources
- id: serial
- task_id: int → Tasks.id
- inventory_allocation_id: int → InventoryAllocations.id
- PRIMARY KEY (task_id, inventory_allocation_id)

## Task Templates

### ModuleTaskTemplates
- id: serial
- module_id: int → Modules.id
- name: string
- description: text
- sequence: int
- duration: interval
- skill_level: enum(basic, intermediate, advanced)
- required_tools: text
- safety_notes: text
- task_type: enum(setup, installation, maintenance, deinstallation, teardown)

### TaskTemplateDependencies
- id: serial
- template_id: int → ModuleTaskTemplates.id
- depends_on_id: int → ModuleTaskTemplates.id
- PRIMARY KEY (template_id, depends_on_id)

### TaskTemplateComponents
- id: serial
- template_id: int → ModuleTaskTemplates.id
- component_id: int → Components.id
- quantity_needed: int
- PRIMARY KEY (template_id, component_id)

## Audit Trail

### ActionLog
- id: serial
- table_name: string
- record_id: int
- action: enum(created, updated, deleted)
- user_id: int → Users.id
- changes: jsonb
- timestamp: timestamp
- INDEX (table_name, record_id, timestamp)

## Design Notes

### Temporal Validity Pattern
- `acts_for`, `ContractorRights`, `PromotionRights` use valid_from/valid_to for time-based relationships
- ActionLog provides complete audit trail, eliminating need for created_at/updated_at on business tables

### Junction Tables
- `SiteProducts`: Many-to-many between Sites and Products (sites can display multiple products)
- `ModuleComponents`: Many-to-many between Modules and Components with quantities
- `FaceProducts`: Many-to-many between Faces and Products
- `CampaignPackages`: Many-to-many between Campaigns and Packages
- `SiteModules`: Many-to-many between Sites and Modules

### Naming Conventions
- All table and field names use underscore_case
- Foreign key fields end with _id and reference the target table name
- Junction tables use singular names of both related entities
- Enum values use lowercase with underscores
