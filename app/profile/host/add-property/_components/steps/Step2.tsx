'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api'
import { MapPin, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAddProperty } from '../../_context/AddPropertyContext'
import { StepNavigation } from '../StepNavigation'
import { AddressComponents } from '@/types'


const libraries: 'places'[] = ['places']

export function Step2({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const { formData, updateField } = useAddProperty()

  const [center, setCenter] = useState({
    lat: Number(formData.latitude) || 13.736717,
    lng: Number(formData.longitude) || 100.523186,
  })
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([])
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [address, setAddress] = useState(formData.address || '')
  const [isLocating, setIsLocating] = useState(false)
  const [isGeocoding, setIsGeocoding] = useState(false)

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    libraries,
  })

  const reverseGeocode = useCallback(
    (lat: number, lng: number) => {
      if (!window.google?.maps) return
      setIsGeocoding(true)
      const geocoder = new window.google.maps.Geocoder()
      geocoder.geocode(
        { location: { lat, lng }, language: 'en' },
        (results, status) => {
          setIsGeocoding(false)
          if (status === 'OK' && results && results.length > 0) {
            const place = results[0]
            const components: AddressComponents = {}

            const stripProvince = (name: string) =>
              name
                .replace(/^(Chang\s*Wat|Changwat|จังหวัด|จ\.)\s*/i, '')
                .replace(/\s*(Chang\s*Wat|Changwat|จังหวัด|Province)$/i, '')
                .trim()

            const stripDistrict = (name: string) =>
              name
                .replace(/^(Khet|Amphoe|อำเภอ|เขต|อ\.)\s*/i, '')
                .replace(/\s*(Khet|Amphoe|อำเภอ|เขต|District)$/i, '')
                .trim()

            place.address_components.forEach((c) => {
              const types = c.types
              if (types.includes('country')) components.country = c.long_name
              if (types.includes('administrative_area_level_1')) {
                const prov = /krung\s*thep/i.test(c.long_name) ? 'Bangkok' : stripProvince(c.long_name)
                components.province = prov
              }
              if (types.includes('administrative_area_level_2'))
                components.district = stripDistrict(c.long_name)
              if (types.includes('sublocality_level_1') && !components.district)
                components.district = stripDistrict(c.long_name)
              if (types.includes('administrative_area_level_3') && !components.district)
                components.district = stripDistrict(c.long_name)
              if (types.includes('locality') && !components.district)
                components.district = stripDistrict(c.long_name)
              if (types.includes('route')) components.route = c.long_name
              if (types.includes('street_number')) components.street_number = c.long_name
              if (types.includes('postal_code')) components.zipcode = c.long_name
            })

            if (components.district?.toLowerCase() === 'mueang' && components.province) {
              components.district = `Mueang ${components.province}`
            }

            updateField('country', components.country || '')
            updateField('province', components.province || '')
            updateField('district', components.district || '')
            updateField('geocodedProvince', components.province || '')
            updateField('geocodedDistrict', components.district || '')
            updateField(
              'address',
              `${components.street_number || ''} ${components.route || ''}`.trim()
            )
            updateField('zipcode', components.zipcode || '')
            setAddress(place.formatted_address || '')
          }
        }
      )
    },
    [updateField]
  )

  // Auto-locate the user if no coordinates are saved yet
  useEffect(() => {
    if (formData.latitude || formData.longitude) return
    if (!navigator.geolocation) return

    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setCenter({ lat, lng })
        updateField('latitude', String(lat))
        updateField('longitude', String(lng))
        setIsLocating(false)
        reverseGeocode(lat, lng)
      },
      () => setIsLocating(false) // user denied or error — fail silently
    )
  }, [formData.latitude, formData.longitude, reverseGeocode, updateField])

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  // Uses Places API (New); the legacy SearchBox cannot be enabled on new Google Cloud projects
  const onSearchChange = (value: string) => {
    setAddress(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (value.trim().length < 2) {
      setSuggestions([])
      return
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
        }
        const { suggestions } =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: value,
            sessionToken: sessionTokenRef.current,
            includedRegionCodes: ['th'],
            language: 'en',
          })
        setSuggestions(suggestions.filter((s) => s.placePrediction))
      } catch (error) {
        console.error('Failed to fetch place suggestions', error)
        setSuggestions([])
      }
    }, 300)
  }

  const onSuggestionSelect = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return
    setSuggestions([])
    try {
      const place = suggestion.placePrediction.toPlace()
      await place.fetchFields({ fields: ['location', 'formattedAddress'] })
      // A session ends once a place is fetched
      sessionTokenRef.current = null
      if (!place.location) return

      const lat = place.location.lat()
      const lng = place.location.lng()
      setCenter({ lat, lng })
      updateField('latitude', String(lat))
      updateField('longitude', String(lng))
      setAddress(place.formattedAddress || '')
      reverseGeocode(lat, lng)
    } catch (error) {
      console.error('Failed to fetch place details', error)
    }
  }

  const onMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return
    const lat = e.latLng.lat()
    const lng = e.latLng.lng()
    setCenter({ lat, lng })
    updateField('latitude', String(lat))
    updateField('longitude', String(lng))
    reverseGeocode(lat, lng)
  }

  // ── Map API still loading ───────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <>
        <div className="w-full text-center mt-5">
          <h3 className="text-deep-teal">Where is your property located?</h3>
          <p className="mb-4 text-neutral-gray text-sm">
            Drag the marker or search to choose your location (within Thailand).
          </p>

          {/* Search box skeleton */}
          <div className="w-full h-10 mb-3 bg-gray-100 animate-pulse rounded-lg" />

          {/* Map skeleton */}
          <div className="w-full h-[380px] rounded-xl bg-gray-100 animate-pulse flex flex-col items-center justify-center gap-2 text-gray-400 border">
            <MapPin className="w-8 h-8 opacity-40" />
            <span className="text-sm">Loading map…</span>
          </div>
        </div>

        <StepNavigation onBack={onBack} onNext={onNext} isNextDisabled />
      </>
    )
  }

  // ── Map loaded ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="w-full text-center mt-5">
        <h3 className="text-deep-teal">Where is your property located?</h3>
        <p className="mb-4 text-neutral-gray text-sm">
          Drag the marker or search to choose your location (within Thailand).
        </p>

        {/* Search box */}
        <div className="relative mb-3">
          <Input
            placeholder="Search location…"
            value={address}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions[0]) {
                e.preventDefault()
                onSuggestionSelect(suggestions[0])
              } else if (e.key === 'Escape') {
                setSuggestions([])
              }
            }}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            className="w-full"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg text-left max-h-64 overflow-y-auto">
              {suggestions.map((suggestion) => {
                const prediction = suggestion.placePrediction!
                return (
                  <li key={prediction.placeId}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSuggestionSelect(suggestion)}
                      className="w-full flex items-start gap-2 px-3 py-2 hover:bg-gray-50 text-sm"
                    >
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-neutral-gray" />
                      <span>
                        <span className="block text-deep-teal font-medium">
                          {prediction.mainText?.text ?? prediction.text.text}
                        </span>
                        {prediction.secondaryText && (
                          <span className="block text-neutral-gray text-xs">
                            {prediction.secondaryText.text}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Map */}
        <div className="relative w-full h-[380px] rounded-xl overflow-hidden shadow-md border">
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={center}
            zoom={15}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              restriction: {
                latLngBounds: {
                  north: 20.5,
                  south: 5.5,
                  west: 97.5,
                  east: 105.5,
                },
                strictBounds: true,
              },
            }}
          >
            <Marker position={center} draggable onDragEnd={onMarkerDragEnd} />
          </GoogleMap>

          {/* Geolocation overlay — shown while waiting for GPS */}
          {isLocating && (
            <div className="absolute inset-0 bg-white/75 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-deep-teal" />
              <span className="text-sm font-medium text-deep-teal">Getting your location…</span>
            </div>
          )}
        </div>

        {/* Status row below map */}
        <div className="flex items-center justify-center gap-1.5 text-neutral-gray text-xs mt-3 h-5">
          {isGeocoding ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Updating address…</span>
            </>
          ) : formData.latitude && formData.longitude ? (
            formData.country === 'Thailand' ? (
              <span className="text-positive-green font-medium">
                Location set — drag the pin to adjust
              </span>
            ) : (
              <span className="text-red-500 font-medium">
                We currently only support properties in Thailand
              </span>
            )
          ) : (
            <span>Search for an address or drag the pin to your property</span>
          )}
        </div>
      </div>

      <StepNavigation
        onBack={onBack}
        onNext={onNext}
        isNextDisabled={
          !formData.latitude ||
          !formData.longitude ||
          isGeocoding ||
          formData.country !== 'Thailand'
        }
      />
    </>
  )
}
