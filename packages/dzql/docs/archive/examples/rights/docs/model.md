# Rights Management Object Model

## Core Entities

### User
```typescript
interface User {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  
  // Relationships
  organisations: Organisation[];  // via acts_for
  assigned_tasks: Task[];
  completed_tasks: Task[];
  team_memberships: Team[];  // via team_members
}
```

### Organisation
```typescript
interface Organisation {
  id: number;
  name: string;
  description: string;
  
  // Relationships
  users: User[];  // via acts_for
  owned_venues: Venue[];
  owned_products: Product[];
  contractor_modules: Module[];
  owned_packages: Package[];
  promoted_packages: Package[];
  sponsored_packages: Package[];
  campaigns: Campaign[];
  
  // Rights and permissions
  contractor_rights: ContractorRights[];
  granted_rights: ContractorRights[];  // rights granted by this org
  promotion_rights_owned: PromotionRights[];  // as owner
  promotion_rights_received: PromotionRights[];  // as promoter
  
  // Commercial relationships
  package_proposals_made: PackageProposal[];
  package_proposals_received: PackageProposal[];
  sponsor_briefs: SponsorBrief[];
  contractor_briefs: SponsorBrief[];  // as contractor
  
  // Inventory
  sponsored_product_items: ProductItem[];
  contractor_product_items: ProductItem[];
  
  // Teams
  contractor_teams: Team[];
}
```

### Venue
```typescript
interface Venue {
  id: number;
  org_id: number;
  name: string;
  address: string;
  description: string;
  lat: number;
  lng: number;
  
  // Relationships
  organisation: Organisation;
  areas: Area[];
  sites: Site[];
  occasions: Occasion[];
  contractor_rights: ContractorRights[];
}
```

### Area
```typescript
interface Area {
  id: number;
  venue_id: number;
  parent_id?: number;
  group_id: number;
  name: string;
  description: string;
  
  // Relationships
  venue: Venue;
  parent_area?: Area;
  child_areas: Area[];
  sites: Site[];
}
```

### Site
```typescript
interface Site {
  id: number;
  venue_id: number;
  area_id?: number;
  name: string;
  description: string;
  lat: number;
  lng: number;
  
  // Relationships
  venue: Venue;
  area?: Area;
  products: Product[];  // via site_products
  modules: Module[];  // via site_modules
  allocations: Allocation[];
  site_info: SiteInfo[];
  performance_scores: Performance[];
}
```

### Product
```typescript
interface Product {
  id: number;
  owner_org_id: number;
  name: string;
  description: string;
  dimensions: object;
  
  // Relationships
  owner_organisation: Organisation;
  sites: Site[];  // via site_products
  faces: Face[];  // via face_products
  performance_scores: Performance[];
  product_items: ProductItem[];
  allocation_options: AllocationOption[];
}
```

## Events & Timing

### Occasion
```typescript
interface Occasion {
  id: number;
  venue_id: number;
  name: string;
  from_date: Date;
  to_date: Date;
  
  // Relationships
  venue: Venue;
  events: Event[];
  moments: Moment[];
  packages: Package[];
  work_windows: WorkWindow[];
  teams: Team[];
  promotion_rights: PromotionRights[];
  sponsor_briefs: SponsorBrief[];
}
```

### Event
```typescript
interface Event {
  id: number;
  occasion_id: number;
  name: string;
  from_datetime: Date;
  to_datetime: Date;
  
  // Relationships
  occasion: Occasion;
}
```

### Moment
```typescript
interface Moment {
  id: number;
  occasion_id: number;
  name: string;
  at_datetime: Date;
  
  // Relationships
  occasion: Occasion;
}
```

## Commercial Operations

### Package
```typescript
interface Package {
  id: number;
  occasion_id?: number;
  owner_id: number;
  promoter_id?: number;
  sponsor_id?: number;
  name: string;
  is_public: boolean;
  
  // Relationships
  occasion?: Occasion;
  owner: Organisation;
  promoter?: Organisation;
  sponsor?: Organisation;
  campaigns: Campaign[];  // via campaign_packages
  proposals: PackageProposal[];
  allocations: Allocation[];
}
```

### Campaign
```typescript
interface Campaign {
  id: number;
  sponsor_id: number;
  name: string;
  description: string;
  
  // Relationships
  sponsor: Organisation;
  packages: Package[];  // via campaign_packages
}
```

### PackageProposal
```typescript
interface PackageProposal {
  id: number;
  package_id: number;
  proposed_by_id: number;
  proposed_to_id: number;
  status: 'pending' | 'accepted' | 'rejected';
  notes: string;
  
  // Relationships
  package: Package;
  proposed_by: Organisation;
  proposed_to: Organisation;
}
```

### Allocation
```typescript
interface Allocation {
  id: number;
  package_id: number;
  site_id: number;
  from_datetime: Date;
  to_datetime: Date;
  
  // Relationships
  package: Package;
  site: Site;
  options: AllocationOption[];
  sponsor_selection?: SponsorSelection;
}
```

### AllocationOption
```typescript
interface AllocationOption {
  id: number;
  allocation_id: number;
  module_id: number;
  face_id: number;
  product_id: number;
  contractor_notes: string;
  
  // Relationships
  allocation: Allocation;
  module: Module;
  face: Face;
  product: Product;
  sponsor_selection?: SponsorSelection;
}
```

### SponsorSelection
```typescript
interface SponsorSelection {
  allocation_id: number;
  option_id: number;
  procurement: 'buy_new' | 'use_stock';
  sponsor_notes: string;
  
  // Relationships
  allocation: Allocation;
  option: AllocationOption;
  inventory_allocations: InventoryAllocation[];
}
```

### SponsorBrief
```typescript
interface SponsorBrief {
  sponsor_id: number;
  occasion_id: number;
  contractor_org_id: number;
  tv_priority: number;  // 0-3
  social_priority: number;  // 0-3
  footfall_priority: number;  // 0-3
  hospitality_priority: number;  // 0-3
  notes: string;
  
  // Assessment scores (nullable)
  plan_assessment_tv_score?: number;
  plan_assessment_social_score?: number;
  plan_assessment_footfall_score?: number;
  plan_assessment_hospitality_score?: number;
  plan_assessment_notes?: string;
  execution_assessment_tv_score?: number;
  execution_assessment_social_score?: number;
  execution_assessment_footfall_score?: number;
  execution_assessment_hospitality_score?: number;
  execution_assessment_notes?: string;
  
  // Relationships
  sponsor: Organisation;
  occasion: Occasion;
  contractor: Organisation;
}
```

## Inventory Management

### Module
```typescript
interface Module {
  id: number;
  contractor_org_id: number;
  name: string;
  dimensions: string;
  
  // Relationships
  contractor_organisation: Organisation;
  components: Component[];  // via module_components with quantities
  faces: Face[];
  sites: Site[];  // via site_modules
  module_items: ModuleItem[];
  allocation_options: AllocationOption[];
  task_templates: ModuleTaskTemplate[];
}
```

### Component
```typescript
interface Component {
  id: number;
  name: string;
  type: 'structural' | 'hardware' | 'tool' | 'accessory';
  description: string;
  specifications: string;
  unit: string;
  
  // Relationships
  modules: Array<{
    module: Module;
    quantity: number;
    notes: string;
  }>;  // via module_components
  task_templates: Array<{
    template: ModuleTaskTemplate;
    quantity_needed: number;
  }>;  // via task_template_components
}
```

### ModuleItem
```typescript
interface ModuleItem {
  id: number;
  module_id: number;
  barcode: string;
  location: string;
  notes: string;
  
  // Relationships
  module: Module;
  inventory_allocations: InventoryAllocation[];
}
```

### ProductItem
```typescript
interface ProductItem {
  id: number;
  product_id: number;
  sponsor_id: number;
  contractor_org_id: number;
  barcode: string;
  location: string;
  notes: string;
  
  // Relationships
  product: Product;
  sponsor: Organisation;
  contractor_organisation: Organisation;
  inventory_allocations: InventoryAllocation[];
}
```

### Face
```typescript
interface Face {
  id: number;
  module_id: number;
  name: string;
  sequence: number;
  orientation: number;  // 0-359
  dimensions: string;
  
  // Relationships
  module: Module;
  products: Product[];  // via face_products
  performance_scores: Performance[];
  allocation_options: AllocationOption[];
}
```

### Performance
```typescript
interface Performance {
  site_id: number;
  face_id: number;
  product_id: number;
  tv_score: number;  // 0-3
  social_score: number;  // 0-3
  footfall_score: number;  // 0-3
  hospitality_score: number;  // 0-3
  
  // Relationships
  site: Site;
  face: Face;
  product: Product;
}
```

### InventoryAllocation
```typescript
interface InventoryAllocation {
  id: number;
  sponsor_selection_id: number;
  module_item_id?: number;
  product_item_id?: number;
  allocated_at: Date;
  returned_at?: Date;
  return_condition?: 'good' | 'damaged' | 'lost';
  condition_notes?: string;
  
  // Relationships
  sponsor_selection: SponsorSelection;
  module_item?: ModuleItem;
  product_item?: ProductItem;
  task_resources: TaskResource[];
}
```

### SiteInfo
```typescript
interface SiteInfo {
  id: number;
  site_id: number;
  contractor_org_id: number;
  dimensions: string;
  notes: string;
  
  // Relationships
  site: Site;
  contractor_organisation: Organisation;
}
```

## Rights Management

### ContractorRights
```typescript
interface ContractorRights {
  id: number;
  contractor_org_id: number;
  granted_by_type: 'owner' | 'sponsor';
  granted_by_id: number;
  venue_id: number;
  valid_from: Date;
  valid_to?: Date;
  
  // Relationships
  contractor_organisation: Organisation;
  granted_by_organisation: Organisation;
  venue: Venue;
}
```

### PromotionRights
```typescript
interface PromotionRights {
  owner_id: number;
  promoter_id: number;
  occasion_id: number;
  valid_from: Date;
  valid_to?: Date;
  
  // Relationships
  owner: Organisation;
  promoter: Organisation;
  occasion: Occasion;
}
```

## Task Management

### Task
```typescript
interface Task {
  id: number;
  name: string;
  description: string;
  duration: string;  // interval
  assigned_to?: number;
  team_id?: number;
  work_window_id?: number;
  completed_by?: number;
  started?: Date;
  completed?: Date;
  
  // Relationships
  assigned_user?: User;
  team?: Team;
  work_window?: WorkWindow;
  completed_by_user?: User;
  dependencies: Task[];  // via task_dependencies
  dependent_tasks: Task[];  // tasks that depend on this one
  resources: InventoryAllocation[];  // via task_resources
}
```

### Team
```typescript
interface Team {
  id: number;
  contractor_org_id: number;
  occasion_id: number;
  name: string;
  
  // Relationships
  contractor_organisation: Organisation;
  occasion: Occasion;
  members: User[];  // via team_members
  tasks: Task[];
}
```

### WorkWindow
```typescript
interface WorkWindow {
  id: number;
  occasion_id: number;
  name: string;
  from_datetime: Date;
  to_datetime: Date;
  
  // Relationships
  occasion: Occasion;
  tasks: Task[];
}
```

### ModuleTaskTemplate
```typescript
interface ModuleTaskTemplate {
  id: number;
  module_id: number;
  name: string;
  description: string;
  sequence: number;
  duration: string;  // interval
  skill_level: 'basic' | 'intermediate' | 'advanced';
  required_tools: string;
  safety_notes: string;
  task_type: 'setup' | 'installation' | 'maintenance' | 'deinstallation' | 'teardown';
  
  // Relationships
  module: Module;
  dependencies: ModuleTaskTemplate[];  // via task_template_dependencies
  dependent_templates: ModuleTaskTemplate[];  // templates that depend on this one
  components: Array<{
    component: Component;
    quantity_needed: number;
  }>;  // via task_template_components
}
```

## Junction Table Details

### Temporal Relationships
- **acts_for**: Users can act for multiple organisations with validity periods
- **ContractorRights**: Time-bounded rights for contractors at venues
- **PromotionRights**: Time-bounded promotion rights for occasions

### Many-to-Many Relationships
- **site_products**: Sites can display multiple products, products can be at multiple sites
- **site_modules**: Sites can have multiple modules, modules can be used at multiple sites
- **face_products**: Faces can display multiple products, products can be on multiple faces
- **campaign_packages**: Campaigns can include multiple packages, packages can be in multiple campaigns
- **team_members**: Teams have multiple users, users can be on multiple teams
- **task_dependencies**: Tasks can depend on multiple other tasks
- **task_resources**: Tasks can require multiple inventory items
- **module_components**: Modules contain multiple components with quantities
- **task_template_dependencies**: Task templates can depend on other templates
- **task_template_components**: Task templates require specific components with quantities

### Composite Key Relationships
- **Performance**: Unique combination of site, face, and product with performance metrics
- **SponsorBrief**: Unique combination of sponsor, occasion, and contractor with assessment data
- **PromotionRights**: Unique combination with temporal validity
- **acts_for**: Unique combination with temporal validity

## Model Notes

### Navigation Patterns
- **Hierarchical**: Organisation → Venue → Area → Site
- **Temporal**: Occasion → Event/Moment with time boundaries
- **Commercial**: Package → Allocation → Option → Selection
- **Operational**: Task → Dependencies → Resources
- **Inventory**: Module → Components → Items

### Key Business Rules
- Allocations must be within occasion date ranges
- Rights must be valid for the time period of use  
- Tasks can have complex dependency chains
- Inventory items can be allocated to multiple tasks
- Performance scores are context-specific (site + face + product)
- Assessment scores track both planning and execution phases