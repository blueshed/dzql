## Contractor Operations & Performance Optimization
- Contractor organisations document site dimensions and capabilities
- Contractor organisations own modules (physical branding equipment) that can be placed at sites
- Modules have faces (surfaces) that display products (flag, banner, etc.)
- Performance scoring tracks all 4 metrics (tv, social, footfall, hospitality) for each site/face/product combination
- Each metric scored 0-3 for comprehensive visibility assessment
- Contractor organisations need rights from venue owner OR sponsor with allocation
- SiteInfo stores contractor organisation's documentation about each site
- SiteModules tracks which contractor organisation modules can fit at which sites
- FaceProducts maps which products can go on which module faces
- Performance table stores complete scoring profile (all 4 metrics) for specific site/face/product combinations
- Enables data-driven optimization of branding placement for maximum impact across all visibility channels

## Inventory Management
- Each module and product item is individually tracked with unique barcode
- ModuleItems tracks individual module items with barcode and location
- ProductItems tracks individual sponsor-branded items held by contractors
- InventoryAllocations links specific barcoded items to sponsor selections
- Status is derived: if allocated and not returned = deployed, if returned = available
- Condition is derived from last InventoryAllocations return_condition (DRY principle)
- New items default to 'good' condition until first use
- Return conditions: good, damaged, or lost with notes
- Damaged items flagged for repair/replacement before reuse
- Lost items permanently unavailable
- Barcode scanning provides instant item status, condition, and history
- Prevents double-booking of specific physical items
- Contractors hold sponsor's branded materials (flags, banners) in their warehouses
- Sponsors decide whether to buy new products or use existing stock

## Task Management
- Tasks are for managing operational workflows (e.g., installation, deinstallation)
- Tasks can be assigned to users and marked started/completed
- Task status (pending, in_progress, completed) is derived from `started` and `completed` timestamps
- `duration` field (PostgreSQL `interval`) estimates task effort
- Tasks can have dependencies (`TaskDependencies`) on other tasks
  - A task cannot be marked started until all its dependencies are completed
  - Prevents circular dependencies
- Tasks can be linked to `InventoryAllocations` via `TaskResources`
  - This identifies the specific barcoded items required for a task

## Promotion Rights & Package Management
- Venue owners (organisations) can delegate promotion rights to another organisation via PromotionRights table
- PromotionRights grants a promoter permission to create packages for specific occasions
- Promotion rights have validity periods (valid_from/valid_to) like other temporal relationships
- Packages can be created by owner or promoter with valid promotion rights for the occasion
- Packages without a sponsor are "available" (not yet sold)
- Packages without an occasion can be templates or multi-occasion deals
- Package access controlled by owner_id, promoter_id (with valid rights), or sponsor_id relationships
- Allocations prevent double-booking of sites through conflict checking

## Sponsor Allocation Workflow
- Contractors present multiple options (AllocationOptions) for each allocation
- Each option specifies module, face, and product with performance scores
- Sponsors review options and make selections (SponsorSelections)
- Selection includes procurement decision: buy_new or use_stock
- One selection per allocation (PRIMARY KEY constraint)
- Options validated for compatibility (module fits site, product fits face)
- Performance scores help sponsors choose optimal configurations
- Clear separation between contractor recommendations and sponsor decisions

## Sponsor Campaigns
- Sponsors can group multiple packages into campaigns
- Campaigns organize packages across venues and occasions
- CampaignPackages links campaigns to their constituent packages
- Enables coordinated branding strategies across multiple events
- Simplifies management of large-scale sponsorship programs

## Sponsor Briefs & Performance Matching
- Sponsors create briefs specifying their performance priorities (0-3 for each metric)
- Briefs act as filters/masks for presenting allocation options
- Each brief covers tv, social, footfall, and hospitality priorities
- One brief per sponsor per occasion
- get_filtered_options uses brief to rank options by match score
- Helps contractors understand sponsor goals and present relevant choices
- Included in get_contractor_info for comprehensive planning

## Package Visibility & Proposals
- Packages can be public (visible to all) or private (visible only to authorized parties)
- PackageProposals table tracks targeted offerings to potential sponsors
- Owners and promoters can propose packages to specific organisations
- Proposals have status: pending, accepted, or rejected
- Multiple proposals can exist for the same package to different potential sponsors
- Accepting a proposal can convert to a sponsor relationship
