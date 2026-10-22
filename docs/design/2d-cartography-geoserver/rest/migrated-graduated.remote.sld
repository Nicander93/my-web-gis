<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>cartography-migrated-graduated</sld:Name>
    <sld:UserStyle>
      <sld:Name>cartography-migrated-graduated</sld:Name>
      <sld:Title>cartography-migrated-graduated</sld:Title>
      <sld:FeatureTypeStyle>
        <sld:Name>gis-c8e5194663f571b8-break-0-line-0-0</sld:Name>
        <sld:Rule>
          <sld:Name>gis-c8e5194663f571b8-break-0-line-0-0</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:Function name="geometryType">
                    <ogc:PropertyName>the_geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>LineString</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:Function name="geometryType">
                    <ogc:PropertyName>the_geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>MultiLineString</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:And>
                <ogc:And>
                  <ogc:Not>
                    <ogc:PropertyIsNull>
                      <ogc:PropertyName>cat</ogc:PropertyName>
                    </ogc:PropertyIsNull>
                  </ogc:Not>
                  <ogc:PropertyIsGreaterThanOrEqualTo>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                    <ogc:Literal>-1.7976931348623157e+308</ogc:Literal>
                  </ogc:PropertyIsGreaterThanOrEqualTo>
                  <ogc:PropertyIsLessThanOrEqualTo>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                    <ogc:Literal>1.7976931348623157e+308</ogc:Literal>
                  </ogc:PropertyIsLessThanOrEqualTo>
                </ogc:And>
                <ogc:PropertyIsLessThanOrEqualTo>
                  <ogc:PropertyName>cat</ogc:PropertyName>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:PropertyIsLessThanOrEqualTo>
              </ogc:And>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ff0000</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">4</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
      <sld:FeatureTypeStyle>
        <sld:Name>gis-c8e5194663f571b8-break-1-line-0-0</sld:Name>
        <sld:Rule>
          <sld:Name>gis-c8e5194663f571b8-break-1-line-0-0</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:And>
                <ogc:Not>
                  <ogc:PropertyIsNull>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                  </ogc:PropertyIsNull>
                </ogc:Not>
                <ogc:PropertyIsGreaterThanOrEqualTo>
                  <ogc:PropertyName>cat</ogc:PropertyName>
                  <ogc:Literal>-1.7976931348623157e+308</ogc:Literal>
                </ogc:PropertyIsGreaterThanOrEqualTo>
                <ogc:PropertyIsLessThanOrEqualTo>
                  <ogc:PropertyName>cat</ogc:PropertyName>
                  <ogc:Literal>1.7976931348623157e+308</ogc:Literal>
                </ogc:PropertyIsLessThanOrEqualTo>
              </ogc:And>
              <ogc:PropertyIsGreaterThan>
                <ogc:PropertyName>cat</ogc:PropertyName>
                <ogc:Literal>2</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#0000ff</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
      <sld:FeatureTypeStyle>
        <sld:Name>gis-c8e5194663f571b8-fallback-0-line-0-0</sld:Name>
        <sld:Rule>
          <sld:Name>gis-c8e5194663f571b8-fallback-0-line-0-0</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:Function name="geometryType">
                    <ogc:PropertyName>the_geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>LineString</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:Function name="geometryType">
                    <ogc:PropertyName>the_geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>MultiLineString</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:Not>
                <ogc:And>
                  <ogc:Not>
                    <ogc:PropertyIsNull>
                      <ogc:PropertyName>cat</ogc:PropertyName>
                    </ogc:PropertyIsNull>
                  </ogc:Not>
                  <ogc:PropertyIsGreaterThanOrEqualTo>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                    <ogc:Literal>-1.7976931348623157e+308</ogc:Literal>
                  </ogc:PropertyIsGreaterThanOrEqualTo>
                  <ogc:PropertyIsLessThanOrEqualTo>
                    <ogc:PropertyName>cat</ogc:PropertyName>
                    <ogc:Literal>1.7976931348623157e+308</ogc:Literal>
                  </ogc:PropertyIsLessThanOrEqualTo>
                </ogc:And>
              </ogc:Not>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#5a5a5a</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

