# Varv UX Design Audit & Improvements
## Based on Nielsen Norman Group Principles

### 🎯 Design Principles for Varv

#### Core Principles for AuDHD Users:
1. **Reduce cognitive load** - Minimize decisions needed
2. **Provide immediate feedback** - Show system status clearly  
3. **Support recovery** - Easy undo/back out of actions
4. **Clarity over cleverness** - Direct language, clear actions
5. **Predictable patterns** - Consistent interaction patterns

---

## 🔍 Current UX Issues & Solutions

### 1. **Visibility of System Status** ⚠️
**Issues:**
- Sync status not clearly visible
- Agent working states unclear
- Energy capacity changes not highlighted

**Solutions:**
```jsx
// Add status indicator component
<StatusBar>
  <SyncStatus status={sync.status} />
  <AgentStatus agents={state.agents} />
  <EnergyLevel capacity={state.capacity} />
</StatusBar>
```

### 2. **User Control & Freedom** ⚠️
**Issues:**
- No undo for task completion
- No confirmation for destructive actions
- Can't easily recover from accidental dismissals

**Solutions:**
```jsx
// Add undo capability
const completeTask = (task) => {
  const previousState = state.tasks;
  setState(prev => ({
    ...prev,
    tasks: prev.tasks.map(t => 
      t.id === task.id ? { ...t, done: true } : t
    ),
    undoAction: () => setState(prev => ({ ...prev, tasks: previousState }))
  }));
};

// Confirmation dialogs for destructive actions
<ConfirmButton
  onConfirm={() => removeIdea(idea.id)}
  message="Är du säker på att du vill ta bort denna idé?"
/>
```

### 3. **Consistency & Standards** ⚠️
**Issues:**
- Inconsistent button styling across tools
- Mixed interaction patterns (some toggle, some navigate)
- Inconsistent terminology

**Solutions:**
```jsx
// Standardized button components
<Button variant="primary" onClick={action}>Primary Action</Button>
<Button variant="secondary" onClick={action}>Secondary</Button>
<Button variant="ghost" onClick={action}>Cancel</Button>

// Consistent interaction patterns
const INTERACTION_PATTERNS = {
  TOGGLE: 'toggle',  // Tools that turn on/off
  NAVIGATE: 'navigate', // Views that switch
  ACTION: 'action'    // One-time actions
};
```

### 4. **Error Prevention** ⚠️
**Issues:**
- No validation on task creation
- No guidance on energy budgeting
- Unclear agent behavior expectations

**Solutions:**
```jsx
// Add validation and guidance
<TaskInput 
  onValidate={(task) => {
    if (!task.title) return "Titeln saknas";
    if (task.energy > availableEnergy) return "Överskrider energibudget";
    return null;
  }}
  hints="Fokusera på vad du ska göra, inte hur"
/>

// Clear expectations for agents
<AgentCard 
  agent="Sorteraren"
  description="Klassar automatiskt som uppgift, idé eller inköp"
  estimatedTime="2-3 sekunder"
/>
```

### 5. **Recognition vs Recall** ⚠️
**Issues:**
- Hidden tool functionalities
- Keyboard shortcuts not visible
- Energy color system needs legend

**Solutions:**
```jsx
// Tool hints on first use
<ToolButton 
  label="Fokusvarv"
  hint={showHints ? "25 minuter fokustid med valfritt mål" : undefined}
/>

// Visible keyboard shortcuts
<KeyboardShortcuts shortcuts={[
  { key: '⌘K', action: 'Ny fångst' },
  { key: '⌘D', action: 'Fokusvarv' }
]} />

// Energy legend
<EnergyLegend>
  <LegendItem color={T.moss} label="Låg (1-2)" />
  <LegendItem color={T.petrol} label="Medel (3)" />
  <LegendItem color={T.warn} label="Hög (4-5)" />
</EnergyLegend>
```

---

## 🎨 Specific Design Pattern Improvements

### Input Controls
```jsx
// Replace checkboxes with toggle switches for binary states
<ToggleSwitch
  checked={task.done}
  onChange={(done) => updateTask(task.id, { done })}
  label="Klar"
/>

// Use radio buttons for mutually exclusive options
<RadioGroup
  value={task.priority}
  onChange={(priority) => updateTask(task.id, { priority })}
  options={[
    { value: 'A', label: 'A - Kritiskt' },
    { value: 'B', label: 'B - Viktigt' },
    { value: 'C', label: 'C - Kan vänta' }
  ]}
/>
```

### Navigation Improvements
```jsx
// Add breadcrumb navigation
<Breadcrumbs>
  <Breadcrumb onClick={() => setView('today')}>Idag</Breadcrumb>
  <Breadcrumb onClick={() => setView('tools')}>Verktyg</Breadcrumb>
  <Breadcrumb current>{toolLabels[tool]}</Breadcrumb>
</Breadcrumbs>

// Add back navigation
<BackButton 
  onClick={() => setView('today')}
  label="Tillbaka till idag"
/>
```

### Form Validation
```jsx
// Real-time validation feedback
<Input
  value={task.title}
  onChange={(title) => setTaskTitle(title)}
  error={title.length === 0 ? "Titeln får inte vara tom" : null}
  hint="Minst 1 tecken, max 120 tecken"
/>

// Energy validation
<EnergyInput
  value={task.energy}
  onChange={(energy) => setTaskEnergy(energy)}
  max={availableEnergy}
  warning={energy > availableEnergy ? "Överskrider dagens budget" : null}
/>
```

### Progress Indication
```jsx
// Show agent processing state
<AgentStatus>
  {agentStatus.classifying && <ProgressBar text="Sorterar fångst..." />}
  {agentStatus.refining && <ProgressBar text="Förfinar idé..." />}
  {agentStatus.breaking && <ProgressBar text="Skapar mikrosteg..." />}
</AgentStatus>

// Sync progress
<SyncStatus>
  {sync.working && (
    <Progress text="Synkroniserar..." percentage={sync.progress} />
  )}
</SyncStatus>
```

---

## ♿ Accessibility Improvements

### Keyboard Navigation
```jsx
// Ensure all interactive elements are keyboard accessible
<button 
  tabIndex={0}
  onKeyDown={(e) => e.key === 'Enter' && onClick()}
  aria-label="Markera uppgift som klar"
>
  {task.done ? '✓ Klar' : '○ Ej klar'}
</button>
```

### Screen Reader Support
```jsx
// Add ARIA labels and roles
<div 
  role="main"
  aria-label="Dagens uppgifter och verktyg"
>
  <section aria-label="Energistatus">
    <div aria-live="polite" aria-atomic="true">
      Energibudget: {energyRemaining} av {energyTotal} kvar
    </div>
  </section>
</div>
```

### Color Accessibility
```javascript
// Ensure sufficient contrast
const ACCESSIBLE_COLORS = {
  paper: "#F2F1EC",   // Good contrast with dark ink
  ink: "#33393B",     // WCAG AA compliant
  spruce: "#46564F",  // Sufficient contrast
  petrol: "#4C6E75",  // Adequate contrast
  moss: "#8A977F",    // May need darkening for better contrast
  warn: "#A66A4F"     // Good contrast
};
```

---

## 📱 Mobile Improvements

### Touch Targets
```jsx
// Ensure minimum touch target size (44x44px)
<button 
  style={{ 
    minWidth: '44px', 
    minHeight: '44px',
    padding: '12px 16px'
  }}
>
  Klar
</button>
```

### Bottom Navigation for Mobile
```jsx
// Use bottom sheet for mobile tools
<MobileBottomSheet>
  <ToolGrid mobile={isMobile}>
    {tools.map(tool => (
      <ToolButton 
        key={tool.id}
        label={tool.label}
        onClick={() => setTool(tool.id)}
      />
    ))}
  </ToolGrid>
</MobileBottomSheet>
```

---

## 🔄 Error Handling & Recovery

### Clear Error Messages
```jsx
// Specific, constructive error messages
const ERROR_MESSAGES = {
  TASK_TITLE_EMPTY: "Uppgiftstiteln saknas. Vad ska du göra?",
  ENERGY_EXCEEDED: `Energibudgeten överskriden. Du har ${available} ⚡ kvar.`,
  SYNC_FAILED: "Kunde inte synkronisera. Kontrollera internetuppkoppling.",
  AGENT_ERROR: "Tjänsten svarar inte. Försök igen om en stund."
};

<ErrorMessage 
  type="warning"
  message={ERROR_MESSAGES[error.code]}
  action={{ 
    label: "Försök igen", 
    onClick: retryAction 
  }}
/>
```

### Recovery Options
```jsx
// Always provide a way forward
<ErrorState 
  message="Synk misslyckades"
  actions={[
    { label: "Försök igen", onClick: retrySync },
    { label: "Arbeta offline", onClick: continueOffline },
    { label: "Kontakt support", onClick: contactSupport }
  ]}
/>
```

---

## 🎯 Implementation Priority

### High Priority (Immediate Impact)
1. **System Status Visibility** - Show sync/agent status clearly
2. **Error Prevention** - Add validation to key inputs  
3. **Recovery Options** - Undo for destructive actions
4. **Keyboard Accessibility** - Ensure all actions work via keyboard

### Medium Priority (Significant Improvement)
5. **Consistent Interactions** - Standardize button/interaction patterns
6. **Form Validation** - Real-time feedback on inputs
7. **Progress Indicators** - Show agent/sync processing
8. **Mobile Touch Targets** - Proper sizing for mobile

### Lower Priority (Polish)
9. **Enhanced Navigation** - Breadcrumbs, back buttons
10. **Help System** - Tooltips, onboarding
11. **Advanced Accessibility** - Screen reader optimization
12. **Animation Polish** - Smooth transitions

---

## 🧪 Usability Testing Checklist

Based on NN/g heuristics, test these scenarios:

### Core User Flows
- [ ] Can user create a task without confusion?
- [ ] Can user recover from accidentally completing a task?
- [ ] Can user understand current energy budget?
- [ ] Can user tell when agents are working?
- [ ] Can user resolve sync errors independently?

### Error Scenarios  
- [ ] What happens when energy budget is exceeded?
- [ ] What happens when sync fails?
- [ ] What happens when agent call fails?
- [ ] What happens when input is invalid?

### Accessibility
- [ ] Can user navigate entire app with keyboard only?
- [ ] Do screen readers announce important changes?
- [ ] Is text readable for users with low vision?
- [ ] Can users with motor impairments use all controls?

---

## 📚 Design System Components

Create reusable components following these patterns:

```jsx
// Button component with variants
const Button = ({ variant = "primary", size = "medium", children, ...props }) => {
  const styles = {
    primary: { background: T.petrol, color: "white" },
    secondary: { background: T.track, color: T.ink },
    ghost: { background: "transparent", color: T.petrol }
  };
  
  return (
    <button 
      style={{...styles[variant], padding: size === "large" ? "12px 20px" : "8px 16px"}}
      {...props}
    >
      {children}
    </button>
  );
};

// Status indicator component
const StatusIndicator = ({ status, message }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
    <StatusDot status={status} />
    <span style={{ fontSize: "14px" }}>{message}</span>
  </div>
);

// Form input with validation
const ValidatedInput = ({ value, onChange, validator, hint }) => {
  const [error, setError] = useState(null);
  
  const handleChange = (newValue) => {
    onChange(newValue);
    const validationError = validator(newValue);
    setError(validationError);
  };
  
  return (
    <div>
      <input 
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        aria-invalid={error !== null}
        aria-describedby={hint ? "input-hint" : undefined}
      />
      {hint && <span id="input-hint">{hint}</span>}
      {error && <ErrorMessage message={error} />}
    </div>
  );
};
```

This systematic approach will significantly improve the UX of Varv while maintaining its core purpose as an AuDHD day companion.