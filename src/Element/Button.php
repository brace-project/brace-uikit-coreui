<?php


namespace Brace\UiKit\CoreUi\Element;


use Phore\Html\Elements\HtmlElement;

class Button
{

    public $name;
    public $icon;
    public $href;

    public $badge = null;

    /**
     * @var Button[]
     */
    public $childreen = [];

    public function __construct ($name, $icon="", $href="", array $childreen = [])
    {
        $this->name = $name;
        $this->icon = $icon;
        $this->href = $href;
        $this->childreen = $childreen;
    }

    public function setBadge(string $name, string $class="badge-info") : self
    {
        $this->badge = fhtml(["span @class=badge @class=:class" => $name], ["class"=>$class]);
        return $this;
    }

}