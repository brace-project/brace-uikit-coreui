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

    $app->router->onGet("/charts", function() {
        return Page::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/charts.php");
    });

    $app->router->onGet("/editor", function() {
        return Page::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/editor.php");
    });

    $app->router->onGet("/table", function() {
        return Page::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/table.php");
    });
    $app->router->onGet("/elements", function() {
        return Page::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/elements.php");
    });

    $app->router->onGet("/icons", function() {
        return Page::createCoreUiPage()
            ->loadHtml(__DIR__ . "/tpl/icons.html");
    });
});