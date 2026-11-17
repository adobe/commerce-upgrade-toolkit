---
name: data-patches
description: "Use only when a UCT/UCA finding requires migrating data forward because the target version removed or restructured a core table/attribute/config path — not for new-feature data setup. If the finding is purely schema (no data to move), th..."
---

# Skill: data-patches (upgrade remediation)

Use only when a UCT/UCA finding requires migrating data forward because the
target version removed or restructured a core table/attribute/config path —
not for new-feature data setup. If the finding is purely schema (no data to
move), that's handled directly by `/upgrade-hop-execute`'s Chunk 2 (declarative
schema migration) — this skill covers only the data-migration case.

## Data patch (DataPatchInterface)
```php
<?php
namespace Vendor\Module\Setup\Patch\Data;

use Magento\Framework\Setup\Patch\DataPatchInterface;
use Magento\Framework\Setup\ModuleDataSetupInterface;

class MigrateRemovedCoreAttribute implements DataPatchInterface
{
    public function __construct(
        private readonly ModuleDataSetupInterface $moduleDataSetup,
        // Inject repositories or config writers here, not ObjectManager
    ) {}

    public function apply(): self
    {
        $this->moduleDataSetup->startSetup();

        // Move data from the removed/renamed core location to its
        // replacement. Use repositories or config model, not raw SQL.

        $this->moduleDataSetup->endSetup();
        return $this;
    }

    public static function getDependencies(): array
    {
        return [
            // List other patches this must run after
        ];
    }

    public function getAliases(): array
    {
        return [];
    }
}
```

## Rules
- Scope: forward-migrating data made unreachable by a breaking change in the
  target version. Do not use this skill to design new patches for new
  features — that's out of scope for this toolkit.
- Patch class names must be globally unique across all modules
- getAliases() returns former class names if this patch replaces an old one
- getDependencies() controls execution order — list all patches that must run
  first
- Use startSetup()/endSetup() always — sets FK check mode
- Use repositories for data manipulation — ResourceConnection for schema only
- Never use InstallData or UpgradeData (deprecated in 2.3+)
- Apply is idempotent: the patch table prevents re-execution, but code should
  be safe to re-run
- Verify before running: bin/magento setup:upgrade --dry-run
- Reference the specific UCT finding ID in the patch's docblock or commit
  message so the migration is traceable back to the breaking change
