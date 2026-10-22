<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>cartography-field-width</sld:Name>
    <sld:UserStyle>
      <sld:Name>cartography-field-width</sld:Name>
      <sld:Title>cartography-field-width</sld:Title>
      <sld:FeatureTypeStyle>
        <sld:Name>field-road</sld:Name>
        <sld:Rule>
          <sld:Name>field-road</sld:Name>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#237d53</sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Mul>
                  <ogc:Function name="if_then_else">
                    <ogc:Function name="isNull">
                      <ogc:PropertyName>cat</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>0</ogc:Literal>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>0.75</ogc:Literal>
                </ogc:Mul>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

