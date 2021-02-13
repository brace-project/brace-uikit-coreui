<?php


namespace Brace\UiKit\CoreUi;


class Page
{
    public $tpl;
    public $content;

    public function __construct ($tpl, $content="")
    {
        $this->tpl = $tpl;
        $this->content = $content;
    }



    public static function createEmptyPage(string $content = "No content") : self
    {
        return new self(__DIR__ . "/../tpl/base.tpl.php", $content);
    }

    public static function createCoreUiPage(string $content = "No content") : self
    {
        return new self(__DIR__ . "/../tpl/coreui-full.tpl.php", $content);
    }
}