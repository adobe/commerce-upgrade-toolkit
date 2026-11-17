# Skill: unit-test-generation

## Test class structure
```php
<?php
namespace Vendor\Module\Test\Unit\Model;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\MockObject\MockObject;
use Vendor\Module\Model\OrderProcessor;
use Vendor\Module\Api\EntityRepositoryInterface;
use Psr\Log\LoggerInterface;

class OrderProcessorTest extends TestCase
{
    private OrderProcessor $subject;
    private EntityRepositoryInterface&MockObject $repositoryMock;
    private LoggerInterface&MockObject $loggerMock;

    protected function setUp(): void
    {
        $this->repositoryMock = $this->createMock(EntityRepositoryInterface::class);
        $this->loggerMock = $this->createMock(LoggerInterface::class);

        $this->subject = new OrderProcessor(
            $this->repositoryMock,
            $this->loggerMock
        );
    }

    public function testProcessOrder_withValidOrder_returnsTrue(): void
    {
        // Arrange
        $orderId = 42;
        $this->repositoryMock->expects($this->once())
            ->method('getById')
            ->with($orderId)
            ->willReturn($this->createOrderEntity($orderId));

        // Act
        $result = $this->subject->process($orderId);

        // Assert
        $this->assertTrue($result);
    }

    public function testProcessOrder_withMissingOrder_throwsException(): void
    {
        $this->expectException(\Magento\Framework\Exception\NoSuchEntityException::class);

        $this->repositoryMock->method('getById')
            ->willThrowException(new \Magento\Framework\Exception\NoSuchEntityException());

        $this->subject->process(999);
    }
}
```

## Naming convention
test{MethodName}_{scenario}_{expectedOutcome}
Examples:
- testSave_withValidData_returnsEntity
- testGetById_withInvalidId_throwsNoSuchEntityException
- testGetList_withEmptyCollection_returnsEmptyResults

## What to mock
- ALL constructor dependencies → createMock() or getMockBuilder()
- External I/O (database, HTTP, filesystem) → always mock
- Other Magento models → mock via their interface, not the concrete class

## What NOT to mock
- Value objects (DTOs, simple data containers) → instantiate directly
- PHP stdlib (array_map, etc.) → use directly
- The class under test → never mock the subject

## Data providers (for parametric cases)
```php
#[DataProvider('invalidInputProvider')]
public function testValidate_withInvalidInput_returnsFalse(mixed $input): void
{
    $this->assertFalse($this->subject->validate($input));
}

public static function invalidInputProvider(): array
{
    return [
        'null input' => [null],
        'empty string' => [''],
        'negative number' => [-1],
    ];
}
```

## Running tests
```bash
# Single test file
vendor/bin/phpunit dev/tests/unit/testsuite/Vendor/Module/Test/Unit/Model/OrderProcessorTest.php

# Full unit suite
vendor/bin/phpunit -c dev/tests/unit/phpunit.xml.dist

# With coverage (requires Xdebug or PCOV)
vendor/bin/phpunit --coverage-text dev/tests/unit/testsuite/Vendor/
```
