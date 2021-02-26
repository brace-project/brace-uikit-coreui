<?php


namespace Brace\UiKit\CoreUi;


use Brace\UiKit\Base\Template\Page;

class CoreUiPage extends Page
{
    public static function createEmptyPage(string $containerElementDef="div") : self
    {
        return new self(__DIR__ . "/../tpl/base.tpl.php", $containerElementDef);
    }

    public static function createCoreUiPage(string $containerElementDef="div @container-fluid @fade-in") : self
    {
        return new self(__DIR__ . "/../tpl/coreui-full.tpl.php", $containerElementDef);
    }
}