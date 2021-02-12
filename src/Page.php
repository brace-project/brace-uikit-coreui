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

}