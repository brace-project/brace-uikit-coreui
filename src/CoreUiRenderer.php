<?php


namespace Brace\UiKit\CoreUi;


use Brace\Core\BraceApp;
use Psr\Http\Message\ResponseInterface;

class CoreUiRenderer
{

    /**
     * @var BraceApp
     */
    private $app;

    public function __construct (BraceApp $app)
    {
        $this->app = $app;
    }


    public function renderPage (CoreUiConfig $config) : ResponseInterface
    {
        ob_start();
        require __DIR__ . "/../tpl/page.tpl.php";
        $c = ob_get_clean();
        return $this->app->responseFactory->createResponseWithBody($c)->withHeader("Content-Type", "text/html");
    }

}