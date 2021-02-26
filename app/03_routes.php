<?php
namespace App;

use Brace\Core\AppLoader;
use Brace\Core\BraceApp;
use Brace\UiKit\CoreUi\CoreUiPage;

AppLoader::extend(function (BraceApp $app) {
    $app->router->on("GET@/", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadMarkdown(__DIR__ . "/tpl/welcome.md");
    });

    $app->router->on("GET@/charts", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/charts.php");
    });

    $app->router->on("GET@/editor", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/editor.php");
    });

    $app->router->on("GET@/table", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/table.php");
    });
    $app->router->on("GET@/elements", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadPHP(__DIR__ . "/tpl/elements.php");
    });

    $app->router->on("GET@/icons", function() {
        return CoreUiPage::createCoreUiPage()
            ->loadHtml(__DIR__ . "/tpl/icons.html");
    });
});