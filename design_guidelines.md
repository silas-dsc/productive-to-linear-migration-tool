# Design Guidelines: Productive Task Exporter (Performance-Optimized)

## Design Approach
**System**: Material Design principles with shadcn/ui components
**Rationale**: Utility-focused application requiring clear feedback, efficient information display, and professional reliability. The existing gradient aesthetic will be maintained while optimizing for performance visibility.

## Core Design Elements

### Typography
- **Headings**: Bold, 32-36px for main title, 20-24px for card titles
- **Body**: 14-16px for labels and content, 13-14px for log entries
- **Monospace**: 13px for technical data (IDs, timestamps, counts)
- **Weight Hierarchy**: Bold (700) for titles, Medium (500) for labels, Regular (400) for content

### Layout System
**Spacing Units**: Tailwind 2, 4, 6, 8 units (0.5rem, 1rem, 1.5rem, 2rem)
- Form fields: gap-4 between inputs, p-6 for card content
- Sections: space-y-6 for main containers, space-y-4 for form groups
- Page margins: py-12 for vertical, px-4 for horizontal containment

### Component Library

**Forms**
- Input fields with clear labels positioned above (Label + Input pairing)
- Password inputs for sensitive API tokens
- Consistent input height (h-10) with rounded-md borders
- Focus states with ring-2 offset

**Progress Indicators**
- Real-time task counter: Bold numerical display (e.g., "Processing: 47/152 tasks")
- Percentage progress bar with smooth transitions
- Loader spinner (Loader2 icon) during active operations
- Status icons: CheckCircle2 (success), AlertCircle (errors)

**Log Display**
- Scrollable log container (max-h-96, overflow-y-auto)
- Timestamp + message format in monospace font
- Type-based styling: info (neutral), success (green accent), warning (amber), error (red accent)
- Auto-scroll to latest entry behavior

**Alerts**
- Success alerts: Green background with CheckCircle2 icon
- Error alerts: Red background with AlertCircle icon
- Positioned below form, above logs for visibility

**Buttons**
- Primary action: Solid background with gradient (slate-700 to slate-900)
- Loading state: Disabled appearance with Loader2 spinner icon
- Icon + Text pattern for Export button (Download icon)
- Consistent padding: px-6 py-2.5

**Cards**
- Single primary card containing all export configuration
- Shadow-xl for elevation, backdrop-blur for depth
- Border-slate-200/50 for subtle definition
- CardHeader with title/description, CardContent for form

### Visual Treatment
- **Background**: Gradient from slate-50 via blue-50 to slate-100
- **Cards**: White/80% opacity with backdrop blur for modern glass effect
- **Icons**: 16x16 for inline elements, 32x32 for header badge
- **Shadows**: xl for cards, lg for icon container
- **Borders**: Rounded-2xl for icon badge, rounded-md for inputs/buttons

### Interaction Patterns
- Disable form inputs during export operation
- Show inline validation messages below fields
- Clear previous status when starting new export
- Append logs in chronological order without clearing previous runs

### Performance Visibility Features
- **Concurrent Request Indicator**: Display "Fetching 5 tasks in parallel..." 
- **Network Activity**: Show active request count and rate limiting status
- **Memory Efficiency**: Stream progress updates, not bulk status
- **Time Estimate**: Calculate and display estimated completion time based on current rate

## Images
**No images required** - This is a utility application where clarity and information density are paramount. The gradient background provides sufficient visual interest without distracting from functionality.