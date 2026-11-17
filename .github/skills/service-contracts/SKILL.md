---
name: service-contracts
description: "A PHP interface in Api/ annotated with @api. It is the stable public surface of your module — other modules depend on it, not on implementation classes."
---

# Skill: service-contracts

## What is a service contract
A PHP interface in Api/ annotated with @api. It is the stable public surface
of your module — other modules depend on it, not on implementation classes.

## Interface rules
- Location: Api/EntityRepositoryInterface.php
- Annotate with @api
- All method signatures must use scalar types or Data interfaces (no Model classes)
- Extend nothing (not \Magento\Framework\Api\SearchCriteriaInterface directly)
- Never change a method signature once deployed — add new methods instead

## Repository interface pattern
```php
<?php
namespace Vendor\Module\Api;

use Vendor\Module\Api\Data\EntityInterface;
use Magento\Framework\Api\SearchCriteriaInterface;
use Vendor\Module\Api\Data\EntitySearchResultsInterface;

/**
 * @api
 */
interface EntityRepositoryInterface
{
    public function getById(int $id): EntityInterface;
    public function save(EntityInterface $entity): EntityInterface;
    public function delete(EntityInterface $entity): bool;
    public function deleteById(int $id): bool;
    public function getList(SearchCriteriaInterface $criteria): EntitySearchResultsInterface;
}
```

## Data interface pattern
```php
<?php
namespace Vendor\Module\Api\Data;

/**
 * @api
 */
interface EntityInterface
{
    public const ENTITY_ID = 'entity_id';
    public const NAME = 'name';

    public function getId(): ?int;
    public function getName(): string;
    public function setName(string $name): self;
}
```

## SearchResults interface
```php
<?php
namespace Vendor\Module\Api\Data;

use Magento\Framework\Api\SearchResultsInterface;

/**
 * @api
 */
interface EntitySearchResultsInterface extends SearchResultsInterface
{
    /** @return EntityInterface[] */
    public function getItems(): array;

    /** @param EntityInterface[] $items */
    public function setItems(array $items): self;
}
```

## di.xml wiring
```xml
<preference for="Vendor\Module\Api\EntityRepositoryInterface"
            type="Vendor\Module\Model\EntityRepository"/>
<preference for="Vendor\Module\Api\Data\EntityInterface"
            type="Vendor\Module\Model\Entity"/>
<preference for="Vendor\Module\Api\Data\EntitySearchResultsInterface"
            type="Magento\Framework\Api\SearchResults"/>
```

## SearchCriteria usage in repository implementation
```php
public function getList(SearchCriteriaInterface $criteria): EntitySearchResultsInterface
{
    $collection = $this->collectionFactory->create();
    $this->collectionProcessor->process($criteria, $collection);

    $results = $this->searchResultsFactory->create();
    $results->setSearchCriteria($criteria);
    $results->setItems($collection->getItems());
    $results->setTotalCount($collection->getSize());
    return $results;
}
```
