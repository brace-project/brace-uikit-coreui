<?php


namespace Brace\UiKit\CoreUi;


class Button
{

    public $name;
    public $icon;
    public $href;

    public function __construct ($name, $icon, $href)
    {
        $this->name = $name;
        $this->icon = $icon;
        $this->href = $href;
    }

}