# The Rights Exchange

## Overview
The Rights Exchange is a marketplace for venue branding rights. **Owners** control venues and define available branding opportunities, which are packaged and sold to **Sponsors** who want visibility at events. To scale operations, owners can delegate package creation to **Promoters** and implementation to **Contractors**, who provide the physical infrastructure and manage installation through coordinated project workflows.

## Core Actors

### 1. Owner (Venue Organisation)
- Controls the venue and its branding sites
- Describes available rights, occasions, and work windows
- Can directly create packages or delegate to promoters
- Grants promotion rights to authorized promoters for specific periods

### 2. Promoter
- Receives promotion rights from owners for specific venues and periods
- Creates and manages packages for occasions at authorized venues
- Markets packages to potential sponsors
- Can create public packages or targeted proposals to specific organisations

### 3. Sponsor
- Purchases packages of allocations for branding opportunities
- Creates briefs specifying performance priorities (TV, social, footfall, hospitality)
- Reviews contractor-provided options for each allocation
- Makes final selections on modules, faces, and products
- Decides whether to buy new products or use existing inventory
- Groups packages into campaigns for coordinated branding strategies

### 4. Contractor
- Documents site dimensions and capabilities
- Owns modules (physical branding equipment) and maintains product inventory
- Creates implementation options for sponsor allocations
- Provides performance scores (0-3) for each site/face/product combination
- Manages barcoded inventory tracking for modules and products
- Ensures selected configurations meet sponsor brief requirements

### 5. Project Builder
- Creates projects to implement sponsor packages
- Manages task workflows with dependencies
- Assigns tasks to workers within work windows
- Links specific barcoded items to tasks via resource allocation
- Tracks task progress (pending, in_progress, completed)

### 6. Worker
- Executes assigned tasks (installation, deinstallation, maintenance)
- Updates task status through started/completed timestamps
- Records return conditions for inventory items
- Provides field feedback on implementation issues

## Key Workflows

### Rights & Package Creation
1. Owner describes venue rights and occasions
2. Owner optionally grants promotion rights to promoters
3. Owner or authorized promoter creates packages
4. Packages can be public or proposed privately to specific sponsors

### Sponsor Allocation Process
1. Sponsor purchases package and creates performance brief
2. Contractor analyzes sites and creates allocation options
3. Each option includes module, face, product, and performance scores
4. Sponsor reviews options filtered by their brief priorities
5. Sponsor makes selections and procurement decisions
6. Selections prevent double-booking through conflict checking

### Implementation & Inventory Management
1. Contractor assigns specific barcoded items to selections
2. Project builder creates tasks with dependencies
3. Workers execute tasks using allocated inventory
4. System tracks item status (available, deployed, damaged, lost)
5. Return conditions determine item availability for future use

## Performance Optimization
The system enables data-driven optimization through:
- Four-metric scoring system (TV, social, footfall, hospitality)
- Performance matching between sponsor briefs and contractor options
- Historical tracking of configuration effectiveness
- Inventory condition monitoring for quality assurance