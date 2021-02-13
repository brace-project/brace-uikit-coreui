<?php


namespace Brace\UiKit\CoreUi;


class Renderer
{

    private $tplFileName;

    private $renderIn;


    public function __construct (string $tplFileName)
    {
        $this->tplFileName = $tplFileName;

    }


    public function renderIn(string $tplFileName)
    {
        $this->renderIn = $tplFileName;
    }


    public function render(CoreUiConfig $__CONFIG, string $__CONTENT) : string
    {
        ob_start();
        require $this->tplFileName;
        $c = ob_get_clean();

        if ($this->renderIn !== null) {
            $subRenderer = new Renderer($this->renderIn);
            $c = $subRenderer->render($__CONFIG, $c);
        }
        return $c;
    }

}