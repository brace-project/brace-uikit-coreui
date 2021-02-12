<?php


namespace Brace\UiKit\CoreUi;


use Phore\Html\Elements\HtmlElement;

class NavBar
{

    private $elements = [];

    private $renderers = [];

    public function addElement(Button $element) : self
    {
        $this->elements[] = $element;
        return $this;
    }

    public function setRenderer(callable $fn, string $class = "*")
    {
        $this->renderers[$class] = $fn;
    }


    public function render($e)
    {
        $e = fhtml($e);

        foreach ($this->elements as $element) {
            $cl = get_class($element);
            $renderer = $this->renderers["*"];
            if (isset ($this->renderers[$cl])) {
                $renderer = $this->renderers[$cl];
            }

            $e[] = $renderer($element);
        }
        return $e;
    }

    public function out($e = "ul @class=nav")
    {
        echo $this->render($e);
    }
}