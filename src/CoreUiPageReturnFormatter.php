<?php


namespace Brace\UiKit\CoreUi;


use Brace\Core\BraceApp;
use Brace\Core\ReturnFormatterInterface;
use Psr\Http\Message\ResponseInterface;

class CoreUiPageReturnFormatter implements ReturnFormatterInterface
{

    /**
     * @var BraceApp
     */
    private $app;

    public function __construct (BraceApp $app)
    {
        $this->app = $app;
    }

    public function canHandle($input): bool
    {
        if ($input instanceof Page)
            return true;
        return false;
    }

    public function transform($input): ResponseInterface
    {
        if ( ! $input instanceof Page)
            throw new \InvalidArgumentException("Input must be instance of Page");

        $renderer = new Renderer($input->tpl);
        $html = $renderer->render($this->app->resolve("coreUiConfig"), $input->content);

        return $this->app->responseFactory->createResponseWithBody($html)->withHeader("Content-Type", "text/html");
    }
}