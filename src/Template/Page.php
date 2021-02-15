<?php


namespace Brace\UiKit\CoreUi\Template;


use Phore\Html\Elements\HtmlElement;
use Phore\Html\Elements\RawHtmlNode;

class Page
{
    private $tpl;

    /**
     * @var HtmlElement
     */
    private $content;

    public function __construct ($tpl, $elementDef)
    {
        $this->tpl = $tpl;
        $this->content = fhtml($elementDef);
    }

    public function addContent($content) : self
    {
        $this->content[] = fhtml($content);
        return $this;
    }

    public function loadHtml (string $filename) : self
    {
        $this->content->loadHtml($filename);
        return $this;
    }

    public function loadMarkdown(string $filename) : self
    {
        $this->content[] = fhtml()::MarkdownFile($filename);
        return $this;
    }

    public function loadPHP (string $filename, mixed $__DATA = []) : self
    {
        ob_start();
        require $filename;
        $content = ob_get_clean();
        $this->content[] = new RawHtmlNode($content);
        return $this;
    }


    /**
     * @return array
     * @internal
     */
    public function _getData() : array
    {
        return [
            "tpl" => $this->tpl,
            "content" => $this->content
        ];
    }


    public static function createEmptyPage(string $containerElementDef="div") : self
    {
        return new self(__DIR__ . "/../../tpl/base.tpl.php", $containerElementDef);
    }

    public static function createCoreUiPage(string $containerElementDef="div @container-fluid @fade-in") : self
    {
        return new self(__DIR__ . "/../../tpl/coreui-full.tpl.php", $containerElementDef);
    }
}