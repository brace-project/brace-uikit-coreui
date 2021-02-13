<?php
namespace App;

use Brace\Core\AppLoader;
use Brace\Core\BraceApp;
use Brace\UiKit\CoreUi\Template\Page;

AppLoader::extend(function (BraceApp $app) {
    $app->router->onGet("/", function() {
        return Page::createCoreUiPage()
            ->loadMarkdown(__DIR__ . "/tpl/welcome.md");
    });
});